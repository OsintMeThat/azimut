"""Downloads travel independently of case identities and retain editable styling."""

import base64
import io
import json
import zipfile
from xml.etree import ElementTree as ET

import pytest
from PIL import Image

from azimut import layout
from azimut.engine import layerexports, maplayers
from azimut.workspace import Case


@pytest.fixture
def work(client):
    owner = client.post("/api/cases", json={"name": "Layer downloads"}).json()["id"]
    layer = client.post(f"/api/cases/{owner}/map-layers/editable", json={"title": "Map & review"}).json()
    url = f"/api/cases/{owner}/map-layers/{layer['name']}"
    group = client.get(f"{url}/edit").json()["groups"][0]
    assert client.patch(f"{url}/groups/{group['id']}", json={"size": 1.75, "stroke": 5.5}).status_code == 200
    point = client.post(f"{url}/markers", json={"lat": 48.85, "lon": 2.35, "symbol": "badge-tank",
                        "colour": "#d55e00", "name": "Gate & point", "description": "Notes & details"}).json()["marker"]
    assert client.post(f"{url}/markers/{point['properties']['key']}/place").status_code == 200
    geometry = {"type": "Polygon", "coordinates": [
        [[2, 48], [3, 48], [3, 49], [2, 48]], [[2.5, 48.2], [2.7, 48.2], [2.7, 48.4], [2.5, 48.2]]
    ]}
    assert client.post(f"{url}/shapes", json={"geometry": geometry, "name": "Area", "colour": "#009e73"}).status_code == 200
    assert client.post(f"{url}/edit").status_code == 200
    return owner, layer, url, geometry


def png(size=(64, 64)):
    stream = io.BytesIO()
    Image.new("RGBA", size, (30, 120, 200, 255)).save(stream, "PNG")
    return stream.getvalue()


@pytest.mark.parametrize("fmt", ["geojson", "kml", "kmz"])
def test_download_includes_the_layer_name_and_optional_description(client, work, fmt):
    _, _, url, _ = work
    details = {"title": "Reviewed map", "description": "Context & notes\nSecond line"}
    assert client.patch(f"{url}/edit", json=details).status_code == 200
    response = client.post(f"{url}/export/{fmt}", json={})
    assert response.status_code == 200, response.text
    if fmt == "geojson":
        content = response.json()
        assert content["name"] == details["title"]
        assert content["description"] == details["description"]
    else:
        data = response.content
        if fmt == "kmz":
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                data = archive.read("doc.kml")
        root = ET.fromstring(data)
        assert root.find("{*}Document/{*}name").text == details["title"]
        assert root.find("{*}Document/{*}description").text == details["description"]


@pytest.mark.parametrize("fmt", ["geojson", "kml", "kmz"])
def test_download_round_trip_keeps_geometry_and_style_without_case_references(client, work, fmt):
    owner, layer, url, geometry = work
    case = Case.open(owner)
    before = case.resolve_inside(layout.layer_spec_rel(layer["name"])).read_bytes()
    icons = {"badge-tank-d55e00": base64.b64encode(png()).decode()}
    response = client.post(f"{url}/export/{fmt}", json={"icons": icons})
    assert response.status_code == 200, response.text
    assert "attachment;" in response.headers["content-disposition"]
    assert response.headers["cache-control"] == "no-store"
    data = response.content
    if fmt == "kmz":
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            assert len(archive.namelist()) == 2
            xml = archive.read("doc.kml")
            root = ET.fromstring(xml)
            href = root.find(".//{*}href").text
            assert archive.read(href) == png()
    else:
        xml = data
    for internal in (b"entity_id", b"place_id", b"layer_origin", b"edit_checkpoint", b"removed_batch"):
        assert internal not in xml
    upload = client.post(f"/api/cases/{owner}/map-layers/editable/upload",
                         files={"file": (f"review.{fmt}", data)}, data={"title": "Imported review"})
    assert upload.status_code == 200, upload.text
    imported = client.get(f"/api/cases/{owner}/map-layers/{upload.json()['name']}/data").json()["features"]
    assert [feature["geometry"]["type"] for feature in imported] == ["Point", "Polygon"]
    assert imported[1]["geometry"] == geometry
    assert imported[0]["properties"]["name"] == "Gate & point"
    assert imported[0]["properties"]["description"] == "Notes & details"
    assert imported[0]["properties"]["symbol"] == "badge-tank"
    assert imported[0]["properties"]["colour"] == "#d55e00"
    assert imported[0]["properties"]["icon_scale"] == 1.75
    assert imported[1]["properties"]["stroke_width"] == 5.5
    assert case.resolve_inside(layout.layer_spec_rel(layer["name"])).read_bytes() == before


@pytest.mark.parametrize("fmt", ["geojson", "kml", "kmz"])
def test_group_order_survives_download_and_reimport(client, work, fmt):
    owner, _, url, _ = work
    base = client.get(f"{url}/edit").json()["groups"][0]
    top = client.post(f"{url}/groups", json={"name": "Upper"}).json()["group"]
    lower = client.post(f"{url}/groups", json={"name": "Lower"}).json()["group"]
    for index, group in enumerate((top, lower)):
        response = client.post(f"{url}/markers", json={"lat": 48.8, "lon": 2.3 + index / 10,
                                                      "group": group["id"], "name": group["name"]})
        assert response.status_code == 200, response.text
    ordered = [top["id"], lower["id"], base["id"]]
    assert client.post(f"{url}/groups/order", json={"ids": ordered}).status_code == 200
    exported = client.post(f"{url}/export/{fmt}", json={})
    assert exported.status_code == 200, exported.text
    imported = client.post(f"/api/cases/{owner}/map-layers/editable/upload",
                           files={"file": (f"groups.{fmt}", exported.content)})
    assert imported.status_code == 200, imported.text
    groups = client.get(f"/api/cases/{owner}/map-layers/{imported.json()['name']}/edit").json()["groups"]
    assert [group["name"] for group in groups] == ["Upper", "Lower", "Features"]


@pytest.mark.parametrize("fmt", ["geojson", "kml"])
def test_an_unknown_end_survives_download_and_reimport(client, work, fmt):
    owner, _, url, _ = work
    assert client.patch(f"{url}/edit", json={"track": {"on": True}}).status_code == 200
    key = client.post(f"{url}/markers", json={"lat": 48.8, "lon": 2.3, "name": "Candidate", "date": "2026-10-13"}).json()["marker"]["properties"]["key"]
    assert client.patch(f"{url}/markers/{key}", json={"end_unknown": True}).status_code == 200
    exported = client.post(f"{url}/export/{fmt}", json={})
    imported = client.post(f"/api/cases/{owner}/map-layers/editable/upload", files={"file": (f"unknown.{fmt}", exported.content)})
    assert imported.status_code == 200, imported.text
    features = client.get(f"/api/cases/{owner}/map-layers/{imported.json()['name']}/edit").json()["document"]["features"]
    said = {feature["properties"]["name"]: feature["properties"].get("end_unknown") for feature in features}
    assert said["Candidate"] is True and said["Area"] is None


def test_hidden_group_is_exported_with_its_visibility(client, work):
    _, _, url, _ = work
    client.patch(url, json={"hidden": ["Features"]})
    response = client.post(f"{url}/export/kml", json={})
    root = ET.fromstring(response.content)
    assert root.find(".//{*}Folder/{*}visibility").text == "0"
    assert len(root.findall(".//{*}Placemark")) == 2


@pytest.mark.parametrize("encoded", ["not base64", base64.b64encode(b"not a PNG").decode(), base64.b64encode(png((513, 1))).decode()])
def test_export_refuses_invalid_icons_without_changing_the_layer(client, work, encoded):
    _, _, url, _ = work
    before = client.get(f"{url}/edit").json()
    assert client.post(f"{url}/export/kmz", json={"icons": {"pin-0072b2": encoded}}).status_code == 422
    assert client.get(f"{url}/edit").json() == before


def test_source_icons_travel_in_kmz_and_read_only_sources_require_an_editable_copy(client):
    owner = client.post("/api/cases", json={"name": "Source map"}).json()["id"]
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w") as zipped:
        zipped.writestr("doc.kml", '<kml><Document><Style id="a"><IconStyle><Icon><href>icon.png</href></Icon></IconStyle></Style>'
                        '<Placemark><styleUrl>#a</styleUrl><Point><coordinates>2,48</coordinates></Point></Placemark></Document></kml>')
        zipped.writestr("icon.png", png())
    source = client.post(f"/api/cases/{owner}/map-layers/upload", files={"file": ("source.kmz", archive.getvalue())}, data={"icons": "true"}).json()
    url = f"/api/cases/{owner}/map-layers/{source['name']}"
    assert client.post(f"{url}/export/kmz", json={}).status_code == 422
    copied = client.post(f"{url}/editable-copy", json={"title": "Working"}).json()
    response = client.post(f"/api/cases/{owner}/map-layers/{copied['name']}/export/kmz", json={})
    assert response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(response.content)) as exported:
        assert any(name.startswith("icons/") for name in exported.namelist())


def test_unknown_personal_style_fields_do_not_enter_imported_layers():
    document = {"type": "FeatureCollection", "azimut_personal_layer": 1, "features": [{
        "type": "Feature", "geometry": {"type": "Point", "coordinates": [2, 48]},
        "properties": {"symbol": "unknown-symbol", "colour": "broken", "icon_scale": 99, "stroke_width": True},
    }]}
    parsed = maplayers.parse(json.dumps(document).encode(), filename="style.geojson")
    props = parsed["geojson"]["features"][0]["properties"]
    assert "symbol" not in props and "icon_scale" not in props and "stroke_width" not in props
    assert layerexports.decode_icons({}) == {}
