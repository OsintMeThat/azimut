"""Personal layers keep their markers separate from the case's places."""

import io
import json
from pathlib import Path

import pytest

from azimut import layout
from azimut.engine import bundles, layerediting, maplayers, workqueue
from azimut.workspace import Case
from test_map_layers import dressed_kmz
from mediafixture import _frame_of, _index, _points, _save_proof, _upload


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


def layer_url(owner, row):
    return f"/api/cases/{owner}/map-layers/{row['name']}"


def at(entity):
    """A link request for an entity at its own point."""
    return {"id": entity["id"], "lat": entity["attrs"]["lat"], "lon": entity["attrs"]["lon"]}


def test_dragging_features_reorders_a_block_and_moves_it_without_changing_case_places(client, owner):
    row = create(client, owner)
    url = layer_url(owner, row)
    points = [marker(client, owner, row, name=name) for name in ("One", "Two", "Three", "Four")]
    keys = [point["properties"]["key"] for point in points]
    place = client.post(f"{url}/markers/{keys[1]}/place").json()["place"]
    group = read(client, owner, row)["groups"][0]["id"]
    other = client.post(f"{url}/groups", json={"name": "Other"}).json()["group"]
    moved = client.post(f"{url}/features/order", json={"keys": [keys[0]], "group": group, "before": keys[3]})
    assert moved.status_code == 200, moved.text
    assert [feature["properties"]["key"] for feature in reversed(moved.json()["document"]["features"])] == [keys[0], keys[3], keys[2], keys[1]]
    # Selection click order does not reverse the visual order of the dragged block.
    moved = client.post(f"{url}/features/order", json={"keys": [keys[1], keys[0]], "group": other["id"]})
    assert moved.status_code == 200, moved.text
    document = moved.json()["document"]["features"]
    block = [feature for feature in reversed(document) if feature["properties"]["group"] == other["id"]]
    assert [feature["properties"]["key"] for feature in block] == [keys[0], keys[1]]
    for feature in document:
        original = points[keys.index(feature["properties"]["key"])]
        assert feature["geometry"] == original["geometry"]
        assert feature["properties"]["colour"] == original["properties"]["colour"]
    assert next(feature for feature in document if feature["properties"]["key"] == keys[1])["properties"]["entity_id"] == place["id"]
    assert Case.open(owner).get_entity(place["id"]) == place


@pytest.mark.parametrize("changes", [
    {"keys": []}, {"keys": ["missing"]}, {"keys": ["first", "first"]},
    {"group": "missing"}, {"before": "first"}, {"before": "missing"}, {"before": "elsewhere"},
])
def test_feature_drops_validate_the_whole_request_before_writing(client, owner, changes):
    row = create(client, owner)
    url = layer_url(owner, row)
    first = marker(client, owner, row)
    other = client.post(f"{url}/groups", json={"name": "Other"}).json()["group"]
    elsewhere = marker(client, owner, row, group=other["id"])
    before = read(client, owner, row)
    group = before["groups"][0]["id"]
    replacements = {"first": first["properties"]["key"], "elsewhere": elsewhere["properties"]["key"]}
    body = {"keys": [replacements["first"]], "group": group, "before": None, **changes}
    body["keys"] = [replacements.get(key, key) for key in body["keys"]]
    body["before"] = replacements.get(body["before"], body["before"])
    assert client.post(f"{url}/features/order", json=body).status_code == 422
    assert read(client, owner, row) == before


def test_layer_details_and_feature_order_restore_on_discard(client, owner):
    response = client.post(f"/api/cases/{owner}/map-layers/editable", json={"title": "Original", "description": "Initial note"})
    assert response.status_code == 200
    row = response.json()
    url = layer_url(owner, row)
    points = [marker(client, owner, row, name=name) for name in ("First", "Second")]
    baseline = read(client, owner, row)
    session = client.post(f"{url}/edit").json()
    changed = client.patch(f"{url}/edit", json={"title": " Renamed ", "description": " Context\nSecond line "})
    assert changed.status_code == 200, changed.text
    assert changed.json()["layer"]["title"] == "Renamed"
    assert changed.json()["layer"]["description"] == "Context\nSecond line"
    assert changed.json()["layer"]["name"] == row["name"]
    case = Case.open(owner)
    entity = case.find_entity(attr="spec", value=layout.layer_spec_rel(row["name"]))
    assert entity["label"] == "Renamed"
    changed = client.post(f"{url}/features/order", json={"keys": [points[0]["properties"]["key"]],
                          "group": baseline["groups"][0]["id"], "before": points[1]["properties"]["key"]}).json()
    assert changed["layer"]["edit_changed"] is True
    restored = client.post(f"{url}/edit/finish", json={"token": session["checkpoint"],
                           "revision": changed["layer"]["edit_revision"], "discard": True})
    assert restored.status_code == 200, restored.text
    assert restored.json()["document"] == baseline["document"]
    assert restored.json()["layer"]["title"] == "Original"
    assert restored.json()["layer"]["description"] == "Initial note"
    assert Case.open(owner).get_entity(entity["id"])["label"] == "Original"
    assert client.patch(f"{url}/edit", json={"description": ""}).json()["layer"]["description"] == ""


@pytest.mark.parametrize("changes", [{"title": " "}, {"title": ""}, {"title": "x" * 201}, {"description": "x" * 4001}])
def test_layer_details_reject_invalid_values_without_changing_the_layer(client, owner, changes):
    row = create(client, owner)
    before = read(client, owner, row)
    assert client.patch(f"{layer_url(owner, row)}/edit", json=changes).status_code == 422
    assert read(client, owner, row) == before


def test_old_edit_checkpoint_keeps_its_name_when_discarded(client, owner):
    row = create(client, owner)
    url = layer_url(owner, row)
    client.post(f"{url}/edit")
    case = Case.open(owner)
    spec = maplayers._read_spec(case, row["name"])
    for field in ("title", "description"):
        spec["edit_checkpoint"]["before"].pop(field, None)
    maplayers._write_spec(case, row["name"], spec)
    current = read(client, owner, row)
    assert current["layer"]["edit_changed"] is False
    restored = client.post(f"{url}/edit/finish", json={"token": current["checkpoint"],
                           "revision": current["layer"]["edit_revision"], "discard": True})
    assert restored.status_code == 200, restored.text
    assert restored.json()["layer"]["title"] == row["title"]


def test_feature_edits_keep_a_label_changed_from_the_case_board(client, owner):
    row = create(client, owner)
    case = Case.open(owner)
    entity = case.find_entity(attr="spec", value=layout.layer_spec_rel(row["name"]))
    case.update_entity(entity["id"], {"label": "Board label"})
    marker(client, owner, row)
    assert Case.open(owner).get_entity(entity["id"])["label"] == "Board label"
    assert client.patch(f"{layer_url(owner, row)}/edit", json={"description": "Context"}).status_code == 200
    assert Case.open(owner).get_entity(entity["id"])["label"] == "Board label"


def test_group_styles_override_without_destroying_individual_styles(client, owner):
    row = create(client, owner)
    point = marker(client, owner, row, colour="#d55e00", symbol="star")
    url = layer_url(owner, row)
    group = client.post(f"{url}/groups", json={"name": "Checked"}).json()["group"]
    key = point["properties"]["key"]
    response = client.patch(f"{url}/markers/{key}", json={"group": group["id"]})
    assert response.status_code == 200
    changed = client.patch(f"{url}/groups/{group['id']}",
                           json={"colour": "#009e73", "symbol": "circle"})
    assert changed.status_code == 200
    drawn = client.get(f"{url}/data").json()["features"][0]["properties"]
    assert (drawn["category"], drawn["colour"], drawn["symbol"]) == ("Checked", "#009e73", "circle")
    own = read(client, owner, row)["document"]["features"][0]["properties"]
    assert (own["colour"], own["symbol"]) == ("#d55e00", "star")
    client.patch(f"{url}/groups/{group['id']}", json={"mode": "individual", "name": "Reviewed"})
    drawn = client.get(f"{url}/data").json()["features"][0]["properties"]
    assert (drawn["category"], drawn["colour"], drawn["symbol"]) == ("Reviewed", "#d55e00", "star")
    assert places(owner) == []


def test_removing_a_group_keeps_its_features_and_case_memberships(client, owner):
    row = create(client, owner)
    url = layer_url(owner, row)
    group = client.post(f"{url}/groups", json={"name": "Checked"}).json()["group"]
    point = marker(client, owner, row, group=group["id"])
    key = point["properties"]["key"]
    place = client.post(f"{url}/markers/{key}/place").json()["place"]
    client.patch(f"{url}/groups/{group['id']}", json={"colour": "#009e73"})
    answer = client.delete(f"{url}/groups/{group['id']}")
    assert answer.status_code == 200
    kept = answer.json()["document"]["features"][0]["properties"]
    assert kept["key"] == key and kept["entity_id"] == place["id"]
    assert kept["colour"] == "#009e73"
    assert len(answer.json()["groups"]) == 1
    last = answer.json()["groups"][0]["id"]
    assert client.delete(f"{url}/groups/{last}").status_code == 422


def test_undoing_a_batch_after_its_group_was_removed_rehomes_the_features(client, owner):
    row = create(client, owner)
    url = layer_url(owner, row)
    group = client.post(f"{url}/groups", json={"name": "Temporary"}).json()["group"]
    points = [marker(client, owner, row, group=group["id"]) for _ in range(2)]
    removed = client.post(f"{url}/selection", json={"keys": [point["properties"]["key"] for point in points], "remove": True})
    assert removed.status_code == 200, removed.text
    remaining = client.delete(f"{url}/groups/{group['id']}").json()["groups"][0]
    restored = client.post(f"{url}/selection/{removed.json()['batch']}/restore")
    assert restored.status_code == 200, restored.text
    assert len(restored.json()["groups"]) == 1
    assert all(feature["properties"]["group"] == remaining["id"] for feature in restored.json()["document"]["features"])


def test_reusing_case_places_in_two_layers_does_not_duplicate_or_restyle_the_place(client, owner):
    case = Case.open(owner)
    place = case.add_entity("place", "Existing gate", attrs={"lat": 48.85, "lon": 2.35}, by="test")
    first, second = create(client, owner, "First"), create(client, owner, "Second")
    for row in (first, second):
        url = layer_url(owner, row)
        answer = client.post(f"{url}/links", json={"items": [at(place), at(place)]})
        assert answer.status_code == 200, answer.text
        assert len(answer.json()["document"]["features"]) == 1
        client.post(f"{url}/links", json={"items": [at(place)]})
        assert len(read(client, owner, row)["document"]["features"]) == 1
    own = read(client, owner, first)["document"]["features"][0]
    client.patch(f"{layer_url(owner, first)}/markers/{own['properties']['key']}",
                 json={"name": "My gate", "colour": "#d55e00"})
    assert read(client, owner, second)["document"]["features"][0]["properties"]["name"] == "Existing gate"
    assert places(owner) == [place]


def test_batch_place_attachment_is_atomic_when_one_place_has_no_coordinates(client, owner):
    case = Case.open(owner)
    valid = case.add_entity("place", "Located", attrs={"lat": 48, "lon": 2}, by="test")
    invalid = case.add_entity("place", "Unknown", by="test")
    row = create(client, owner)
    response = client.post(f"{layer_url(owner, row)}/links", json={"items": [at(valid), {"id": invalid["id"], "lat": 0, "lon": 0}]})
    assert response.status_code == 422
    assert read(client, owner, row)["document"]["features"] == []


def test_removing_and_undoing_membership_keeps_place_and_relations(client, owner):
    row = create(client, owner)
    point = marker(client, owner, row, name="Gate", symbol="star")
    other = marker(client, owner, row, name="Other", lat=49)
    url = layer_url(owner, row)
    key = point["properties"]["key"]
    place = client.post(f"{url}/markers/{key}/place").json()["place"]
    case = Case.open(owner)
    note = case.add_entity("note", "A linked note", by="test")
    case.add_link(note["id"], place["id"], "related-to", by="test")
    before = case.list_links()
    answer = client.delete(f"{url}/markers/{key}")
    assert answer.status_code == 200
    assert [f["properties"]["key"] for f in answer.json()["document"]["features"]] == [other["properties"]["key"]]
    assert places(owner) == [place] and case.list_links() == before
    restored = client.post(f"{url}/markers/{key}/restore").json()["document"]["features"]
    assert restored[0]["properties"]["key"] == key
    assert restored[0]["properties"]["entity_id"] == place["id"]
    assert restored[0]["properties"]["symbol"] == "star"
    assert client.post(f"{url}/markers/{key}/restore").status_code == 422


def test_place_usage_and_trash_restore_keep_layer_coordinates_and_refresh_membership(client, owner):
    case = Case.open(owner)
    place = case.add_entity("place", "Shared gate", attrs={"lat": 48.85, "lon": 2.35}, by="test")
    note = case.add_entity("note", "Related finding", by="test")
    case.add_link(note["id"], place["id"], "related-to", by="test")
    rows = [create(client, owner, title) for title in ("First", "Second")]
    for row in rows:
        client.post(f"{layer_url(owner, row)}/links", json={"items": [at(place)]})
        client.get(f"{layer_url(owner, row)}/data")
    before = read(client, owner, rows[0])["layer"]["sha256"]
    usage = client.get(f"/api/cases/{owner}/map-layers/places/{place['id']}/usage").json()
    assert {row["title"] for row in usage["layers"]} == {"First", "Second"}
    assert usage["related"] == [{"id": note["id"], "label": note["label"], "type": "note"}]
    removed = client.delete(f"/api/cases/{owner}/entities/{place['id']}").json()
    for row in rows:
        drawn = client.get(f"{layer_url(owner, row)}/data").json()["features"][0]
        assert drawn["geometry"]["coordinates"] == [2.35, 48.85]
        assert "entity_id" not in drawn["properties"]
    assert read(client, owner, rows[0])["layer"]["sha256"] != before
    client.post(f"/api/cases/{owner}/trash/{removed['trash']}/restore")
    for row in rows:
        assert client.get(f"{layer_url(owner, row)}/data").json()["features"][0]["properties"]["entity_id"] == place["id"]
    assert case.list_links()[0]["to"] == place["id"]


@pytest.mark.parametrize("changes", [{"mode": "by-secret"}, {"colour": "red"}, {"symbol": "script"}])
def test_invalid_group_styles_do_not_write(client, owner, changes):
    row = create(client, owner)
    group = read(client, owner, row)["groups"][0]
    before = read(client, owner, row)
    assert client.patch(f"{layer_url(owner, row)}/groups/{group['id']}", json=changes).status_code == 422
    assert read(client, owner, row) == before


def test_icon_palette_matches_the_frontend_and_all_round_icons_are_persisted(client, owner):
    palette = json.loads((Path(__file__).parents[1] / "frontend/src/lib/map/layerSymbols.json").read_text())
    assert {entry["id"] for entry in palette} == set(layerediting.SYMBOLS)
    row = create(client, owner)
    for symbol in layerediting.SYMBOLS:
        marker(client, owner, row, symbol=symbol, colour="#009e73")
    drawn = client.get(f"{layer_url(owner, row)}/data").json()["features"]
    assert {f["properties"]["symbol"] for f in drawn} == set(layerediting.SYMBOLS)


def test_marker_names_do_not_repeat_after_removal(client, owner):
    row = create(client, owner)
    first = marker(client, owner, row)
    second = marker(client, owner, row)
    client.delete(f"{layer_url(owner, row)}/markers/{first['properties']['key']}")
    third = marker(client, owner, row)
    assert [first["properties"]["name"], second["properties"]["name"], third["properties"]["name"]] == [
        "Marker 1", "Marker 2", "Marker 3",
    ]


def test_empty_group_visibility_survives_style_edits_and_adding_shows_the_new_point(client, owner):
    row = create(client, owner)
    url = layer_url(owner, row)
    group = read(client, owner, row)["groups"][0]
    hidden = client.patch(url, json={"hidden": [group["name"]]})
    assert hidden.json()["hidden"] == [group["name"]]
    styled = client.patch(f"{url}/groups/{group['id']}", json={"colour": "#009e73"})
    assert styled.json()["layer"]["hidden"] == [group["name"]]
    marker(client, owner, row, group=group["id"])
    assert read(client, owner, row)["layer"]["hidden"] == []


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
    assert read(client, owner, row)["document"]["features"][0]["properties"]["entity_id"] == one["place"]["id"]


def test_promotion_reuses_an_existing_case_place_without_renaming_it(client, owner):
    existing = client.post(f"/api/cases/{owner}/satellite/place",
                           json={"lat": 48.85, "lon": 2.35, "title": "Established place"}).json()
    row = create(client, owner)
    first = marker(client, owner, row, name="My label")
    promoted = client.post(f"/api/cases/{owner}/map-layers/{row['name']}/markers/{first['properties']['key']}/place",
                            json={}).json()["place"]
    assert promoted["id"] == existing["id"] and promoted["label"] == "Established place"
    assert len(places(owner)) == 1


@pytest.mark.parametrize("coordinates", [[181, 48], [2, 91], ["invalid", 48], [2]])
def test_promotion_refuses_invalid_imported_coordinates_without_creating_places(client, owner, coordinates):
    row = create(client, owner)
    first = marker(client, owner, row)
    case = Case.open(owner)
    spec = maplayers._read_spec(case, row["name"])
    spec["document"]["features"][0]["geometry"]["coordinates"] = coordinates
    maplayers._write_spec(case, row["name"], spec)
    response = client.post(
        f"/api/cases/{owner}/map-layers/{row['name']}/markers/{first['properties']['key']}/place",
        json={},
    )
    assert response.status_code == 422
    assert places(owner) == []


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
    drawn = client.get(f"/api/cases/{owner}/map-layers/{row['name']}/data").json()["features"]
    assert drawn == [{**feature, "properties": {**feature["properties"], "icon_scale": 1, "stroke_width": 2}}
                     for feature in before["features"]]


def test_deleting_a_promoted_place_keeps_the_marker_and_proof_based_media_location(client, owner):
    source = _upload(client, owner, "source.png")
    frame = _frame_of(owner, source)
    _save_proof(client, owner, "Located source", [frame], coords={"lat": 48.85, "lon": 2.35})
    row = create(client, owner)
    feature = marker(client, owner, row)
    saved = client.post(
        f"/api/cases/{owner}/map-layers/{row['name']}/markers/{feature['properties']['key']}/place",
        json={},
    ).json()["place"]
    assert _points(_index(client, owner), source) == [(48.85, 2.35)]
    usage = client.get(f"/api/cases/{owner}/map-layers/places/{saved['id']}/usage").json()
    assert any(item["type"] == "proof" for item in usage["related"])
    response = client.delete(f"/api/cases/{owner}/entities/{saved['id']}")
    assert response.status_code == 200
    kept = read(client, owner, row)["document"]["features"][0]
    assert "entity_id" not in kept["properties"]
    assert kept["geometry"]["coordinates"] == [2.35, 48.85]
    assert _points(_index(client, owner), source) == [(48.85, 2.35)]
    restored = client.post(f"/api/cases/{owner}/trash/{response.json()['trash']}/restore")
    assert restored.status_code == 200
    assert read(client, owner, row)["document"]["features"][0]["properties"]["entity_id"] == saved["id"]
    assert _points(_index(client, owner), source) == [(48.85, 2.35)]


def test_bundle_round_trip_rebuilds_the_working_copy_and_keeps_its_original(client, owner, monkeypatch):
    monkeypatch.setattr(workqueue, "start_workers", False)
    data = dressed_kmz()
    row = client.post(f"/api/cases/{owner}/map-layers/editable/upload",
                      files={"file": ("source.kmz", io.BytesIO(data))}).json()
    marker(client, owner, row, name="New marker", symbol="flag")
    before = read(client, owner, row)["document"]
    case = Case.open(owner)
    job = bundles.queue_export(case)
    workqueue.drain(case)
    imported, import_job = bundles.queue_import(Path(job["payload"]["output"]))
    workqueue.drain(imported)
    imported = Case.open(imported.id)
    assert imported.get_job(import_job["id"])["state"] == "ready"
    assert read(client, imported.id, row)["document"] == before
    assert imported.resolve_inside(layout.layer_snapshot_rel(row["name"])).read_bytes() == data
    cache = maplayers.drawing(imported, row["name"])
    drawn = {f["properties"]["key"]: f for f in json.loads(cache.read_text())["features"]}
    assert len(drawn) == len(before["features"])
    for feature in before["features"]:
        rendered = drawn[feature["properties"]["key"]]
        assert rendered["geometry"] == feature["geometry"]
        assert rendered["properties"]["name"] == feature["properties"]["name"]
        assert rendered["properties"]["icon_scale"] == 1


def finish_edit(client, url, *, discard=False, token=None, revision=None):
    live = client.get(f"{url}/edit").json()
    return client.post(f"{url}/edit/finish", json={
        "token": token or live["checkpoint"], "revision": revision or live["layer"]["edit_revision"],
        "discard": discard,
    })


def test_group_size_and_order_control_the_drawing_without_changing_case_places(client, owner):
    row = create(client, owner)
    url = layer_url(owner, row)
    first = marker(client, owner, row, name="First")
    group = client.post(f"{url}/groups", json={"name": "Second"}).json()["group"]
    second = marker(client, owner, row, name="Second", group=group["id"])
    first_group = first["properties"]["group"]
    response = client.patch(f"{url}/groups/{group['id']}", json={"size": 2.25})
    assert response.status_code == 200
    assert client.post(f"{url}/groups/order", json={"ids": [group["id"], first_group]}).status_code == 200
    drawn = client.get(f"{url}/data").json()["features"]
    assert [f["properties"]["key"] for f in drawn] == [first["properties"]["key"], second["properties"]["key"]]
    assert drawn[-1]["properties"]["icon_scale"] == 2.25
    # Size also applies to a group with individual colours and symbols.
    client.patch(f"{url}/groups/{group['id']}", json={"mode": "individual"})
    assert client.get(f"{url}/data").json()["features"][-1]["properties"]["icon_scale"] == 2.25
    before = read(client, owner, row)
    for ids in ([first_group], [first_group, first_group], [first_group, "unknown"]):
        assert client.post(f"{url}/groups/order", json={"ids": ids}).status_code == 422
        assert read(client, owner, row) == before
    assert places(owner) == []


@pytest.mark.parametrize("size", [0, 0.49, 3.01, "invalid"])
def test_group_size_is_bounded_at_the_edge(client, owner, size):
    row = create(client, owner)
    group = read(client, owner, row)["groups"][0]
    before = read(client, owner, row)
    assert client.patch(f"{layer_url(owner, row)}/groups/{group['id']}", json={"size": size}).status_code == 422
    assert read(client, owner, row) == before


def test_back_restores_groups_points_visibility_and_removals_but_keeps_explicit_case_places(client, owner):
    row = create(client, owner)
    url = layer_url(owner, row)
    point = marker(client, owner, row, name="Original")
    before = read(client, owner, row)
    start = client.post(f"{url}/edit", json={}).json()
    assert start["checkpoint"] and not start["layer"]["edit_changed"]
    key = point["properties"]["key"]
    client.delete(f"{url}/markers/{key}")
    added = marker(client, owner, row, name="Separate case place")
    saved = client.post(f"{url}/markers/{added['properties']['key']}/place").json()["place"]
    group = client.post(f"{url}/groups", json={"name": "New group"}).json()["group"]
    client.patch(f"{url}/groups/{group['id']}", json={"size": 3})
    client.patch(url, json={"hidden": ["Markers"]})
    assert read(client, owner, row)["layer"]["edit_changed"]
    restored = finish_edit(client, url, discard=True)
    assert restored.status_code == 200, restored.text
    assert restored.json()["document"] == before["document"]
    assert restored.json()["groups"] == before["groups"]
    assert restored.json()["layer"]["hidden"] == before["layer"]["hidden"]
    assert restored.json()["checkpoint"] is None
    assert not restored.json()["layer"]["edit_changed"]
    assert Case.open(owner).get_entity(saved["id"])
    assert client.post(f"{url}/markers/{key}/restore").status_code == 422


def test_done_commits_the_current_work_and_starts_a_fresh_checkpoint_next_time(client, owner):
    row = create(client, owner)
    url = layer_url(owner, row)
    original = client.post(f"{url}/edit", json={}).json()["checkpoint"]
    point = marker(client, owner, row)
    response = finish_edit(client, url)
    assert response.status_code == 200
    assert response.json()["document"]["features"][0]["properties"]["key"] == point["properties"]["key"]
    assert response.json()["checkpoint"] is None
    new = client.post(f"{url}/edit", json={}).json()
    assert new["checkpoint"] != original
    assert not new["layer"]["edit_changed"]


def test_stale_discard_refuses_to_overwrite_newer_work(client, owner):
    row = create(client, owner)
    url = layer_url(owner, row)
    start = client.post(f"{url}/edit", json={}).json()
    marker(client, owner, row)
    before = read(client, owner, row)
    response = finish_edit(client, url, discard=True, revision=start["layer"]["edit_revision"])
    assert response.status_code == 422
    assert read(client, owner, row) == before
    assert finish_edit(client, url, discard=True, token="a" * 32).status_code == 422


LINE = {"type": "LineString", "coordinates": [[2, 48], [2.1, 48.1]]}
AREA = {"type": "Polygon", "coordinates": [[[2, 48], [2.1, 48], [2.1, 48.1], [2, 48]]]}


@pytest.mark.parametrize("geometry", [LINE, AREA])
def test_drawn_shapes_can_be_edited_removed_and_discarded(client, owner, geometry):
    row = create(client, owner)
    url = layer_url(owner, row)
    response = client.post(f"{url}/shapes", json={"geometry": geometry, "name": "Working shape"})
    assert response.status_code == 200, response.text
    feature = response.json()["document"]["features"][0]
    key = feature["properties"]["key"]
    assert feature["geometry"] == geometry
    client.post(f"{url}/edit", json={})
    changed = json.loads(json.dumps(geometry))
    if geometry["type"] == "LineString":
        changed["coordinates"][1][0] = 2.2
    else:
        changed["coordinates"][0][1][0] = 2.2
    edited = client.patch(f"{url}/markers/{key}", json={"geometry": changed})
    assert edited.status_code == 200
    assert edited.json()["marker"]["geometry"] == changed
    assert client.post(f"{url}/markers/{key}/place").status_code == 422
    client.delete(f"{url}/markers/{key}")
    assert read(client, owner, row)["document"]["features"] == []
    assert client.post(f"{url}/markers/{key}/restore").status_code == 200
    assert finish_edit(client, url, discard=True).json()["document"]["features"][0]["geometry"] == geometry
    assert places(owner) == []


def test_a_marker_on_a_case_place_follows_it_until_unlinked(client, owner):
    """Its point is the place's: moving the place moves it, and moving it alone
    is refused until it stops following. The place never moves with it."""
    row = create(client, owner)
    url = layer_url(owner, row)
    point = marker(client, owner, row)
    key = point["properties"]["key"]
    place = client.post(f"{url}/markers/{key}/place").json()["place"]
    moved = {"type": "Point", "coordinates": [3, 49]}
    response = client.patch(f"{url}/markers/{key}", json={"geometry": moved})
    assert response.status_code == 422
    assert "unlink" in response.json()["detail"]
    case = Case.open(owner)
    case.update_entity(place["id"], {"attrs": {**place["attrs"], "lat": 48.9, "lon": 2.4}})
    assert client.get(f"{url}/data").json()["features"][0]["geometry"]["coordinates"] == [2.4, 48.9]
    unlinked = client.patch(f"{url}/markers/{key}", json={"unlink": True})
    assert unlinked.status_code == 200, unlinked.text
    assert "entity_id" not in unlinked.json()["marker"]["properties"]
    assert unlinked.json()["marker"]["geometry"]["coordinates"] == [2.4, 48.9]
    response = client.patch(f"{url}/markers/{key}", json={"geometry": moved})
    assert response.status_code == 200
    assert response.json()["marker"]["geometry"] == moved
    assert Case.open(owner).get_entity(place["id"])["attrs"]["lat"] == 48.9


@pytest.mark.parametrize("geometry", [
    {"type": "LineString", "coordinates": [[2, 48]]},
    {"type": "LineString", "coordinates": [[2, 48], [2, 48]]},
    {"type": "Polygon", "coordinates": [[[2, 48], [3, 48], [3, 49]]]},
    {"type": "Polygon", "coordinates": [[[2, 48], [2, 48], [2, 48], [2, 48]]]},
    {"type": "LineString", "coordinates": [[181, 48], [2, 48]]},
    {"type": "LineString", "coordinates": [[2, 91], [2, 48]]},
    {"type": "LineString", "coordinates": [[True, 48], [2, 48]]},
    {"type": "LineString", "coordinates": [["2", 48], [2, 48]]},
    {"type": "Polygon", "coordinates": ["invalid"]},
    {"type": "Unknown", "coordinates": [[2, 48], [2, 49]]},
])
def test_invalid_geometry_is_refused_without_writing(client, owner, geometry):
    row = create(client, owner)
    url = layer_url(owner, row)
    point = marker(client, owner, row)
    before = read(client, owner, row)
    assert client.post(f"{url}/shapes", json={"geometry": geometry}).status_code == 422
    assert client.patch(f"{url}/markers/{point['properties']['key']}", json={"geometry": geometry}).status_code == 422
    assert read(client, owner, row) == before


def test_geometry_limits_and_type_changes_are_refused(client, owner):
    row = create(client, owner)
    url = layer_url(owner, row)
    point = marker(client, owner, row)
    assert client.patch(f"{url}/markers/{point['properties']['key']}", json={"geometry": LINE}).status_code == 422
    assert client.post(f"{url}/shapes", json={"geometry": {"type": "LineString", "coordinates": [[2, 48]] * 4097}}).status_code == 422


def test_active_edit_checkpoint_survives_a_case_bundle(client, owner, monkeypatch):
    monkeypatch.setattr(workqueue, "start_workers", False)
    row = create(client, owner)
    url = layer_url(owner, row)
    client.post(f"{url}/edit", json={})
    client.post(f"{url}/shapes", json={"geometry": AREA})
    case = Case.open(owner)
    job = bundles.queue_export(case)
    workqueue.drain(case)
    imported, import_job = bundles.queue_import(Path(job["payload"]["output"]))
    workqueue.drain(imported)
    imported = Case.open(imported.id)
    assert imported.get_job(import_job["id"])["state"] == "ready"
    new_url = layer_url(imported.id, row)
    assert client.post(f"{new_url}/edit", json={}).json()["layer"]["edit_changed"]
    assert finish_edit(client, new_url, discard=True).json()["document"]["features"] == []


def test_selection_edits_are_atomic_and_keep_case_places(client, owner):
    row = create(client, owner)
    first = marker(client, owner, row, name="First")
    second = marker(client, owner, row, name="Second", lon=179)
    url = layer_url(owner, row)
    place = client.post(f"{url}/markers/{first['properties']['key']}/place").json()["place"]
    keys = [first["properties"]["key"], second["properties"]["key"]]
    before = read(client, owner, row)
    for body in ({"keys": keys, "offset": [2, 0]}, {"keys": [keys[0], "missing"], "remove": True},
                 {"keys": [keys[0], keys[0]], "changes": {"colour": "#009e73"}},
                 {"keys": keys, "changes": {"group": "missing"}}):
        response = client.post(f"{url}/selection", json=body)
        assert response.status_code == 422, response.text
        assert read(client, owner, row) == before
    moved = client.post(f"{url}/selection", json={"keys": keys, "offset": [-1, 1],
                        "changes": {"colour": "#009e73", "symbol": "badge-tank"}})
    assert moved.status_code == 200, moved.text
    # the marker on the case place stays on it; the other one moves
    assert [f["geometry"]["coordinates"] for f in moved.json()["document"]["features"]] == [[2.35, 48.85], [178, 49.85]]
    assert moved.json()["kept"] == 1
    assert all(f["properties"]["symbol"] == "badge-tank" for f in moved.json()["document"]["features"])
    assert Case.open(owner).get_entity(place["id"])["attrs"]["lat"] == 48.85
    removed = client.post(f"{url}/selection", json={"keys": keys, "remove": True})
    assert removed.status_code == 200
    assert removed.json()["document"]["features"] == []
    batch = removed.json()["batch"]
    restored = client.post(f"{url}/selection/{batch}/restore")
    assert restored.status_code == 200
    assert [f["properties"]["key"] for f in restored.json()["document"]["features"]] == keys
    assert client.post(f"{url}/selection/{batch}/restore").status_code == 422
    assert len(places(owner)) == 1


@pytest.mark.parametrize("stroke", [0, 0.49, 12.1, "invalid"])
def test_group_line_width_is_bounded(client, owner, stroke):
    row = create(client, owner)
    url = layer_url(owner, row)
    group = read(client, owner, row)["groups"][0]
    assert client.patch(f"{url}/groups/{group['id']}", json={"stroke": stroke}).status_code == 422
    assert read(client, owner, row)["groups"][0]["stroke"] == 2


def test_group_line_width_reaches_drawn_shapes(client, owner):
    row = create(client, owner)
    url = layer_url(owner, row)
    group = read(client, owner, row)["groups"][0]
    client.post(f"{url}/shapes", json={"geometry": {"type": "LineString", "coordinates": [[2, 48], [3, 49]]}})
    assert client.patch(f"{url}/groups/{group['id']}", json={"stroke": 5.5}).status_code == 200
    assert client.get(f"{url}/data").json()["features"][0]["properties"]["stroke_width"] == 5.5


def test_a_feature_carries_its_own_look_and_how_sure_it_is(client, owner):
    """Width, dash, arrow, fill, size and its name on the map, each cleared by sending nothing."""
    row = create(client, owner)
    url = layer_url(owner, row)
    line = client.post(f"{url}/shapes", json={"geometry": {"type": "LineString", "coordinates": [[2.3, 48.8], [2.4, 48.9]]},
                                               "line_width": 5, "line_dash": "dashed", "line_arrow": "end", "confidence": "claimed",
                                               "credit": "GeoConfirmed — geoconfirmed.org"})
    assert line.status_code == 200, line.text
    key = line.json()["key"]
    drawn = client.get(f"{url}/data").json()["features"][0]["properties"]
    assert (drawn["stroke_width"], drawn["line_dash"], drawn["line_arrow"], drawn["confidence"]) == (5, "dashed", "end", "claimed")
    assert drawn["credit"] == "GeoConfirmed — geoconfirmed.org"
    cleared = client.patch(f"{url}/markers/{key}", json={"line_dash": None, "line_width": None, "label": "on", "label_size": 14})
    assert cleared.status_code == 200, cleared.text
    drawn = client.get(f"{url}/data").json()["features"][0]["properties"]
    assert "line_dash" not in drawn and drawn["stroke_width"] == 2 and drawn["show_label"] is True and drawn["label_size"] == 14
    for wrong in ({"line_dash": "wavy"}, {"line_width": 40}, {"confidence": "maybe"}, {"area_fill": "plaid"}):
        assert client.patch(f"{url}/markers/{key}", json=wrong).status_code == 422


def test_a_group_lends_its_look_to_features_that_set_none(client, owner):
    row = create(client, owner)
    url = layer_url(owner, row)
    area = client.post(f"{url}/shapes", json={"geometry": {"type": "Polygon", "coordinates": [[[2.3, 48.8], [2.4, 48.8], [2.4, 48.9], [2.3, 48.8]]]}})
    own = client.post(f"{url}/shapes", json={"geometry": {"type": "Polygon", "coordinates": [[[2.5, 48.8], [2.6, 48.8], [2.6, 48.9], [2.5, 48.8]]]},
                                              "area_fill": "none"})
    group = read(client, owner, row)["groups"][0]["id"]
    assert client.patch(f"{url}/groups/{group}", json={"area_fill": "hatch", "line_dash": "dotted"}).status_code == 200
    drawn = {feature["properties"]["key"]: feature["properties"] for feature in client.get(f"{url}/data").json()["features"]}
    assert drawn[area.json()["key"]]["area_fill"] == "hatch"
    assert drawn[own.json()["key"]]["area_fill"] == "none"
    # null clears a group's look
    assert client.patch(f"{url}/groups/{group}", json={"area_fill": None}).status_code == 200
    drawn = {feature["properties"]["key"]: feature["properties"] for feature in client.get(f"{url}/data").json()["features"]}
    assert "area_fill" not in drawn[area.json()["key"]]


def test_revert_puts_features_back_and_drops_the_ones_an_edit_made(client, owner):
    """The editor's undo and redo: whole features back by their key, new ones out."""
    row = create(client, owner)
    url = layer_url(owner, row)
    first = marker(client, owner, row, name="Depot")
    before = read(client, owner, row)["document"]["features"][0]
    client.patch(f"{url}/markers/{first['properties']['key']}", json={"name": "Moved depot"})
    second = marker(client, owner, row, name="Bridge")
    answer = client.post(f"{url}/revert", json={"put": [before], "drop": [second["properties"]["key"]]})
    assert answer.status_code == 200, answer.text
    features = read(client, owner, row)["document"]["features"]
    assert [feature["properties"]["name"] for feature in features] == ["Depot"]
    # a feature put back after it was removed comes back with its key
    client.delete(f"{url}/markers/{first['properties']['key']}")
    assert client.post(f"{url}/revert", json={"put": [before], "drop": []}).status_code == 200
    assert read(client, owner, row)["document"]["features"][0]["properties"]["key"] == first["properties"]["key"]
    # what is put back is checked as a drawn feature is
    broken = {**before, "geometry": {"type": "Point", "coordinates": [500, 48]}}
    assert client.post(f"{url}/revert", json={"put": [broken], "drop": []}).status_code == 422
    assert client.post(f"{url}/revert", json={"put": [{"geometry": before["geometry"], "properties": {}}], "drop": []}).status_code == 422
