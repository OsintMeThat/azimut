"""What a personal-layer feature says beyond its style, and the edits on several at once."""

import base64
import io
import zipfile

import pytest

from azimut.workspace import Case
from mediafixture import _png_bytes, _upload


@pytest.fixture
def owner(client):
    return client.post("/api/cases", json={"name": "Layer features"}).json()["id"]


def create(client, owner, title="Working map"):
    response = client.post(f"/api/cases/{owner}/map-layers/editable", json={"title": title})
    assert response.status_code == 200, response.text
    return response.json()


def url_of(owner, row):
    return f"/api/cases/{owner}/map-layers/{row['name']}"


def marker(client, owner, row, **fields):
    response = client.post(f"{url_of(owner, row)}/markers", json={"lat": 48.85, "lon": 2.35, **fields})
    assert response.status_code == 200, response.text
    return response.json()["marker"]


def line(client, owner, row, coordinates, **fields):
    response = client.post(f"{url_of(owner, row)}/shapes",
                           json={"geometry": {"type": "LineString", "coordinates": coordinates}, **fields})
    assert response.status_code == 200, response.text
    return response.json()["key"]


def features(client, owner, row):
    return {f["properties"]["key"]: f for f in client.get(f"{url_of(owner, row)}/edit").json()["document"]["features"]}


# -- the fields --------------------------------------------------------------------


def test_a_marker_keeps_its_day_status_direction_links_and_provenance(client, owner):
    row = create(client, owner)
    point = marker(client, owner, row, date="2026-09-13T08:00:00Z", status="destroyed", bearing=370,
                   links=["https://x.com/a/1", "https://x.com/a/1", "https://t.me/b/2"], provenance="external")
    properties = point["properties"]
    assert properties["date"] == "2026-09-13"
    assert properties["status"] == "destroyed"
    assert properties["bearing"] == 10
    assert properties["links"] == ["https://x.com/a/1", "https://t.me/b/2"]
    assert properties["provenance"] == "external"
    drawn = client.get(f"{url_of(owner, row)}/data").json()["features"][0]["properties"]
    assert (drawn["status"], drawn["date"], drawn["bearing"]) == ("destroyed", "2026-09-13", 10)


def test_an_edit_clears_a_field_by_sending_nothing_and_leaves_the_others(client, owner):
    row = create(client, owner)
    key = marker(client, owner, row, status="damaged", date="2026-01-02", links=["https://a.example/x"])["properties"]["key"]
    answer = client.patch(f"{url_of(owner, row)}/markers/{key}", json={"status": None, "name": "Kept"})
    assert answer.status_code == 200, answer.text
    properties = answer.json()["marker"]["properties"]
    assert "status" not in properties
    assert (properties["date"], properties["links"], properties["name"]) == ("2026-01-02", ["https://a.example/x"], "Kept")


@pytest.mark.parametrize("fields", [
    {"status": "burnt"}, {"date": "yesterday"}, {"links": ["ftp://a.example/x"]},
    {"links": [f"https://a.example/{n}" for n in range(11)]}, {"provenance": "rumour"},
])
def test_a_field_outside_its_values_writes_nothing(client, owner, fields):
    row = create(client, owner)
    before = client.get(f"{url_of(owner, row)}/edit").json()["document"]
    response = client.post(f"{url_of(owner, row)}/markers", json={"lat": 48, "lon": 2, **fields})
    assert response.status_code == 422
    assert client.get(f"{url_of(owner, row)}/edit").json()["document"] == before


def test_a_selection_takes_a_status_at_once(client, owner):
    row = create(client, owner)
    keys = [marker(client, owner, row)["properties"]["key"] for _ in range(3)]
    answer = client.post(f"{url_of(owner, row)}/selection", json={"keys": keys[:2], "changes": {"status": "damaged"}})
    assert answer.status_code == 200, answer.text
    status = {key: f["properties"].get("status") for key, f in features(client, owner, row).items()}
    assert status == {keys[0]: "damaged", keys[1]: "damaged", keys[2]: None}


def test_a_group_can_write_its_names_on_the_map(client, owner):
    row = create(client, owner)
    marker(client, owner, row, name="Gate")
    group = client.get(f"{url_of(owner, row)}/edit").json()["groups"][0]["id"]
    assert client.patch(f"{url_of(owner, row)}/groups/{group}", json={"labels": True}).status_code == 200
    assert client.get(f"{url_of(owner, row)}/data").json()["features"][0]["properties"]["show_label"] is True
    assert client.patch(f"{url_of(owner, row)}/groups/{group}", json={"labels": False}).status_code == 200
    assert "show_label" not in client.get(f"{url_of(owner, row)}/data").json()["features"][0]["properties"]


# -- moving, merging and splitting ------------------------------------------------


def test_moving_a_selection_can_be_undone(client, owner):
    row = create(client, owner)
    keys = [marker(client, owner, row, lon=lon)["properties"]["key"] for lon in (2, 3)]
    moved = client.post(f"{url_of(owner, row)}/selection", json={"keys": keys, "offset": [0.5, 0.25]})
    assert moved.status_code == 200, moved.text
    assert [features(client, owner, row)[key]["geometry"]["coordinates"] for key in keys] == [[2.5, 49.1], [3.5, 49.1]]
    assert client.post(f"{url_of(owner, row)}/selection/{moved.json()['batch']}/restore").status_code == 200
    assert [features(client, owner, row)[key]["geometry"]["coordinates"] for key in keys] == [[2, 48.85], [3, 48.85]]


def test_lines_that_meet_merge_into_one_line_whichever_way_they_were_drawn(client, owner):
    row = create(client, owner)
    first = line(client, owner, row, [[2, 48], [2.1, 48]], name="Front")
    second = line(client, owner, row, [[2.2, 48.1], [2.1, 48]])
    answer = client.post(f"{url_of(owner, row)}/merge", json={"keys": [first, second]})
    assert answer.status_code == 200, answer.text
    kept = features(client, owner, row)
    assert list(kept) == [first]
    assert kept[first]["geometry"] == {"type": "LineString", "coordinates": [[2, 48], [2.1, 48], [2.2, 48.1]]}
    assert kept[first]["properties"]["name"] == "Front"
    assert client.post(f"{url_of(owner, row)}/selection/{answer.json()['batch']}/restore").status_code == 200
    restored = features(client, owner, row)
    assert restored[first]["geometry"]["coordinates"] == [[2, 48], [2.1, 48]]
    assert restored[second]["geometry"]["coordinates"] == [[2.2, 48.1], [2.1, 48]]


def test_lines_apart_merge_into_parts_and_split_back(client, owner):
    row = create(client, owner)
    first = line(client, owner, row, [[2, 48], [2.1, 48]], name="Trench")
    second = line(client, owner, row, [[3, 48], [3.1, 48]])
    merged = client.post(f"{url_of(owner, row)}/merge", json={"keys": [first, second]})
    assert merged.json()["document"]["features"][0]["geometry"]["type"] == "MultiLineString"
    split = client.post(f"{url_of(owner, row)}/split", json={"key": first})
    assert split.status_code == 200, split.text
    parts = features(client, owner, row)
    assert [f["geometry"]["type"] for f in parts.values()] == ["LineString", "LineString"]
    assert sorted(f["properties"]["name"] for f in parts.values()) == ["Trench", "Trench 2"]
    assert client.post(f"{url_of(owner, row)}/selection/{split.json()['batch']}/restore").status_code == 200
    assert [f["geometry"]["type"] for f in features(client, owner, row).values()] == ["MultiLineString"]


def test_a_line_is_cut_at_one_of_its_middle_points(client, owner):
    row = create(client, owner)
    key = line(client, owner, row, [[2, 48], [2.1, 48], [2.2, 48]])
    assert client.post(f"{url_of(owner, row)}/split", json={"key": key, "at": 2}).status_code == 422
    answer = client.post(f"{url_of(owner, row)}/split", json={"key": key, "at": 1})
    assert answer.status_code == 200, answer.text
    assert [f["geometry"]["coordinates"] for f in features(client, owner, row).values()] == [
        [[2, 48], [2.1, 48]], [[2.1, 48], [2.2, 48]]]


def test_areas_merge_into_one_feature_of_parts(client, owner):
    row = create(client, owner)
    ring = lambda x: [[[x, 48], [x + 0.1, 48], [x + 0.1, 48.1], [x, 48]]]  # noqa: E731
    keys = [client.post(f"{url_of(owner, row)}/shapes", json={"geometry": {"type": "Polygon", "coordinates": ring(x)}}).json()["key"]
            for x in (2, 3)]
    answer = client.post(f"{url_of(owner, row)}/merge", json={"keys": keys})
    assert answer.status_code == 200, answer.text
    assert features(client, owner, row)[keys[0]]["geometry"] == {"type": "MultiPolygon", "coordinates": [ring(2), ring(3)]}


@pytest.mark.parametrize("kinds", [("point", "point"), ("line", "point")])
def test_points_and_mixed_kinds_do_not_merge(client, owner, kinds):
    row = create(client, owner)
    made = {"point": lambda: marker(client, owner, row)["properties"]["key"],
            "line": lambda: line(client, owner, row, [[2, 48], [2.1, 48]])}
    keys = [made[kind]() for kind in kinds]
    before = features(client, owner, row)
    assert client.post(f"{url_of(owner, row)}/merge", json={"keys": keys}).status_code == 422
    assert features(client, owner, row) == before


# -- markers that follow a case item -----------------------------------------------


def _proof(client, owner, points, path=None, rename_from=None):
    path = path or _upload(client, owner, "panel.png")
    spec = {"panels": [{"id": "p0", "src": path}], "points": points, "coordsText": points[0]["coords"]}
    answer = client.post(f"/api/cases/{owner}/proofs", json={
        "title": "Strike", "spec": spec, "png_base64": base64.b64encode(_png_bytes((10, 10, 10))).decode(),
        **({"rename_from": rename_from} if rename_from else {})})
    assert answer.status_code == 200, answer.text
    return {**answer.json(), "path": path}


def test_a_proof_offers_its_checked_points_and_its_marker_follows_a_correction(client, owner):
    proof = _proof(client, owner, [{"coords": "48.85, 2.35"}, {"coords": "48.86, 2.36", "label": "Crater"},
                                   {"coords": "48.87, 2.37", "proposed": True}])
    offered = [item for item in client.get(f"/api/cases/{owner}/layer-links").json() if item["kind"] == "proof"]
    assert [(item["lat"], item["lon"], item["title"]) for item in offered] == [
        (48.85, 2.35, "Strike"), (48.86, 2.36, "Strike · Crater")]
    row = create(client, owner)
    added = client.post(f"{url_of(owner, row)}/links", json={"items": [{"id": proof["id"], "lat": 48.86, "lon": 2.36}]})
    assert added.status_code == 200, added.text
    assert added.json()["added"] == 1
    # the analyst moves the crater a few metres in the composer, and saves
    again = _proof(client, owner, [{"coords": "48.85, 2.35"}, {"coords": "48.8605, 2.3605", "label": "Crater"}],
                   path=proof["path"], rename_from=proof["name"])
    assert again["id"] == proof["id"]
    drawn = client.get(f"{url_of(owner, row)}/data").json()["features"][0]
    assert drawn["geometry"]["coordinates"] == [2.3605, 48.8605]
    assert (drawn["properties"]["entity_type"], drawn["properties"]["entity_label"]) == ("proof", "Strike")


def test_layer_targets_list_each_layer_its_groups_and_the_markers_following_an_item(client, owner):
    proof = _proof(client, owner, [{"coords": "48.85, 2.35"}, {"coords": "48.86, 2.36", "label": "Crater"}])
    first, second = create(client, owner, "Front"), create(client, owner, "Strikes")
    group = client.post(f"{url_of(owner, second)}/groups", json={"name": "Craters"}).json()["group"]
    assert client.post(f"{url_of(owner, second)}/links", json={
        "items": [{"id": proof["id"], "lat": 48.86, "lon": 2.36}], "group": group["id"]}).status_code == 200
    marker(client, owner, first, name="Unrelated")

    bare = client.get(f"/api/cases/{owner}/layer-targets").json()
    assert [(row["title"], row["markers"]) for row in bare] == [("Front", []), ("Strikes", [])]
    # the styles each layer shows, as drawn: a marker of its own, and the proof's in its group's
    assert bare[0]["styles"] == [{"symbol": "pin", "colour": "#0072b2"}]
    assert bare[1]["styles"] == [{"symbol": group["symbol"], "colour": group["colour"].lower()}]
    assert [one["name"] for one in bare[1]["groups"]] == ["Markers", "Craters"]
    assert set(bare[1]["groups"][0]) == {"id", "name", "mode", "colour", "symbol"}

    rows = {row["title"]: row for row in client.get(f"/api/cases/{owner}/layer-targets", params={"entity": proof["id"]}).json()}
    assert rows["Front"]["markers"] == []
    [held] = rows["Strikes"]["markers"]
    assert (held["group"], held["lat"], held["lon"]) == (group["id"], 48.86, 2.36)
    # the marker answers where the proof's point stands now, not where it was added
    _proof(client, owner, [{"coords": "48.85, 2.35"}, {"coords": "48.8605, 2.3605", "label": "Crater"}],
           path=proof["path"], rename_from=proof["name"])
    [moved] = client.get(f"/api/cases/{owner}/layer-targets", params={"entity": proof["id"]}).json()[1]["markers"]
    assert (moved["lat"], moved["lon"]) == (48.8605, 2.3605)


def test_a_followed_point_can_take_an_icon_and_a_colour_of_its_own(client, owner):
    proof = _proof(client, owner, [{"coords": "48.85, 2.35"}])
    row = create(client, owner)
    item = {"id": proof["id"], "lat": 48.85, "lon": 2.35}
    refused = client.post(f"{url_of(owner, row)}/links", json={"items": [item], "symbol": "not-an-icon"})
    assert refused.status_code == 422
    assert client.post(f"{url_of(owner, row)}/links", json={"items": [item], "colour": "red"}).status_code == 422
    added = client.post(f"{url_of(owner, row)}/links", json={"items": [item], "symbol": "badge-tank", "colour": "#d55e00"})
    assert added.status_code == 200, added.text
    [marker] = features(client, owner, row).values()
    assert (marker["properties"]["symbol"], marker["properties"]["colour"], marker["properties"]["entity_id"]) == (
        "badge-tank", "#d55e00", proof["id"])


def test_an_item_with_no_point_cannot_be_added(client, owner):
    note = Case.open(owner).add_entity("note", "Unplaced", by="test")
    row = create(client, owner)
    answer = client.post(f"{url_of(owner, row)}/links", json={"items": [{"id": note["id"], "lat": 0, "lon": 0}]})
    assert answer.status_code == 422


# -- reading a pasted text -----------------------------------------------------------


def test_a_pasted_post_gives_its_points_its_links_and_its_day(client):
    text = ("Strike on the depot, 13 SEP 2026. Geolocated: 48.8584, 2.2945 "
            "https://x.com/someone/status/1 https://www.google.com/maps/@48.86,2.30,17z")
    body = client.post("/api/geo/scan", json={"text": text}).json()
    assert [(p["lat"], p["lon"]) for p in body["points"]] == [(48.8584, 2.2945), (48.86, 2.30)]
    assert body["links"][0] == "https://x.com/someone/status/1"
    assert body["date"] == "2026-09-13"


def test_a_day_written_two_ways_is_not_guessed(client):
    assert client.post("/api/geo/scan", json={"text": "03/04/2026"}).json()["date"] == ""


# -- downloads -------------------------------------------------------------------


@pytest.mark.parametrize("fmt", ["kml", "geojson"])
def test_a_download_brings_the_fields_back_on_import(client, owner, fmt):
    row = create(client, owner)
    marker(client, owner, row, name="Depot", date="2026-09-13", status="damaged", bearing=45,
           links=["https://x.com/a/1"], provenance="external")
    data = client.post(f"{url_of(owner, row)}/export/{fmt}", json={"icons": {}}).content
    upload = client.post(f"/api/cases/{owner}/map-layers/editable/upload",
                         files={"file": (f"back.{fmt}", io.BytesIO(data), "application/octet-stream")},
                         data={"title": "Back"})
    assert upload.status_code == 200, upload.text
    back = client.get(f"/api/cases/{owner}/map-layers/{upload.json()['name']}/edit").json()["document"]["features"][0]
    properties = back["properties"]
    assert (properties["date"], properties["status"], properties["bearing"]) == ("2026-09-13", "damaged", 45)
    assert (properties["links"], properties["provenance"]) == (["https://x.com/a/1"], "external")
    assert "azimut_status" not in properties.get("description", "")


def test_a_kmz_stamps_the_day_on_the_placemark(client, owner):
    row = create(client, owner)
    marker(client, owner, row, date="2026-09-13")
    data = client.post(f"{url_of(owner, row)}/export/kmz", json={"icons": {}}).content
    kml = zipfile.ZipFile(io.BytesIO(data)).read("doc.kml").decode()
    assert "<when>2026-09-13</when>" in kml


# -- named colours ---------------------------------------------------------------------


def test_the_case_names_its_colours_and_the_map_reads_the_names(client, owner):
    url = f"/api/cases/{owner}/layer-palette"
    assert client.get(url).json() == {"colours": []}
    saved = client.put(url, json={"colours": [{"name": "Side A", "colour": "#0072B2"}, {"name": "Side B", "colour": "#d55e00"}]})
    assert saved.status_code == 200, saved.text
    assert saved.json()["colours"][0] == {"name": "Side A", "colour": "#0072b2"}
    row = create(client, owner)
    marker(client, owner, row, colour="#0072b2")
    marker(client, owner, row, colour="#0072b2")
    marker(client, owner, row, colour="#009e73")
    drawn = client.get(f"{url_of(owner, row)}/data").json()["features"]
    assert [feature["properties"].get("colour_name") for feature in drawn] == ["Side A", "Side A", None]
    listed = next(one for one in client.get(f"/api/cases/{owner}/map-layers").json() if one["name"] == row["name"])
    assert listed["colours"] == {"#0072b2": 2, "#009e73": 1}
    # renaming a colour reaches a drawing already cached
    client.put(url, json={"colours": [{"name": "Ours", "colour": "#0072b2"}]})
    assert client.get(f"{url_of(owner, row)}/data").json()["features"][0]["properties"]["colour_name"] == "Ours"


@pytest.mark.parametrize("colours", [
    [{"name": "A", "colour": "#0072b2"}, {"name": "B", "colour": "#0072b2"}],
    [{"name": "Same", "colour": "#0072b2"}, {"name": "same", "colour": "#d55e00"}],
    [{"name": "A", "colour": "blue"}],
    [{"name": f"C{n}", "colour": f"#0000{n:02x}"} for n in range(13)],
])
def test_a_palette_that_names_ambiguously_is_refused(client, owner, colours):
    url = f"/api/cases/{owner}/layer-palette"
    client.put(url, json={"colours": [{"name": "Kept", "colour": "#009e73"}]})
    assert client.put(url, json={"colours": colours}).status_code == 422
    assert client.get(url).json()["colours"] == [{"name": "Kept", "colour": "#009e73"}]


def test_the_named_colours_travel_with_the_case_bundle(client, owner):
    from azimut.engine import bundles

    client.put(f"/api/cases/{owner}/layer-palette", json={"colours": [{"name": "Side A", "colour": "#0072b2"}]})
    destination = Case.create(bundles.imported_name("Palette travels"))
    imported = Case.open(bundles.import_into(destination, bundles.export_case(Case.open(owner)))["case_id"])
    assert client.get(f"/api/cases/{imported.id}/layer-palette").json()["colours"] == [{"name": "Side A", "colour": "#0072b2"}]
