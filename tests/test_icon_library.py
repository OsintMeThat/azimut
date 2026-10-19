"""The analyst's own icons: a library in Settings, and the copy each layer keeps.

What these pin down is the promise made to the analyst: an imported icon is
offered in every case, a layer that wears one keeps its own copy (so a case
travels without the library), a map's own icons are never lost to a colour
pick, and the backup moves the library to another machine.
"""

import base64
import io
import zipfile

import pytest
from PIL import Image, ImageDraw

from azimut import layout
from azimut.engine import iconlibrary, layerexports, maplayers
from azimut.workspace import Case


def glyph(colour=(20, 20, 20), size=(48, 48), background=None, fmt="PNG") -> bytes:
    """A filled triangle, on transparency unless a background is given."""
    image = Image.new("RGBA", size, (*background, 255) if background else (0, 0, 0, 0))
    ImageDraw.Draw(image).polygon([(size[0] // 2, 4), (size[0] - 4, size[1] - 4), (4, size[1] - 4)],
                                  fill=(*colour, 255))
    buffer = io.BytesIO()
    image.convert("RGB" if fmt == "JPEG" else "RGBA").save(buffer, fmt)
    return buffer.getvalue()


def painted() -> bytes:
    """Three colours side by side: a picture, not a silhouette."""
    image = Image.new("RGBA", (60, 20), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    for index, colour in enumerate([(220, 30, 30), (30, 180, 60), (40, 70, 220)]):
        draw.rectangle([index * 20, 0, index * 20 + 19, 19], fill=(*colour, 255))
    buffer = io.BytesIO()
    image.save(buffer, "PNG")
    return buffer.getvalue()


def upload(client, *files, groups=None):
    response = client.post("/api/icons", files=[("files", (name, data, "image/png")) for name, data in files],
                           data={"groups": groups or []})
    assert response.status_code == 200, response.text
    return response.json()


def imported(client, name="tank.png", data=None):
    return upload(client, (name, data or glyph()))["added"][0]


@pytest.fixture
def owner(client):
    return client.post("/api/cases", json={"name": "Own icons"}).json()["id"]


def editable(client, owner, title="Working map"):
    row = client.post(f"/api/cases/{owner}/map-layers/editable", json={"title": title}).json()
    return f"/api/cases/{owner}/map-layers/{row['name']}", row


def zip_keys(owner, row):
    path = Case.open(owner).resolve_inside(layout.layer_icons_rel(row["name"]))
    with zipfile.ZipFile(path) as archive:
        return {name.removesuffix(".png") for name in archive.namelist()}


# ---------------------------------------------------------------------------
# The library
# ---------------------------------------------------------------------------


def test_an_imported_icon_is_named_after_its_file_and_stored_as_a_square_png(client):
    icon = imported(client, "t72_tank-v2.png", glyph(size=(48, 30)))

    assert icon["name"] == "T72 tank v2"
    assert icon["group"] == iconlibrary.DEFAULT_GROUP
    stored = Image.open(io.BytesIO(client.get(f"/api/icons/{icon['key']}.png").content))
    assert stored.format == "PNG" and stored.width == stored.height <= 256
    assert client.get("/api/icons").json()["icons"] == [icon]


def test_a_one_colour_icon_is_drawn_in_a_disc_and_a_painted_one_as_it_is(client):
    answer = upload(client, ("glyph.png", glyph()), ("flag.png", painted()))

    assert [icon["mode"] for icon in answer["added"]] == ["disc", "image"]


def test_the_same_picture_imported_twice_is_one_icon(client):
    first = upload(client, ("tank.png", glyph()))
    again = upload(client, ("other-name.png", glyph()))

    assert len(first["added"]) == 1
    assert again["added"] == [] and again["already"] == 1
    assert len(client.get("/api/icons").json()["icons"]) == 1


def test_an_icon_on_a_flat_background_loses_the_background(client):
    icon = upload(client, ("on-white.jpg", glyph(background=(255, 255, 255), fmt="JPEG")))["added"][0]

    stored = Image.open(io.BytesIO(client.get(f"/api/icons/{icon['key']}.png").content)).convert("RGBA")
    assert stored.getpixel((0, 0))[3] == 0
    assert stored.getpixel((stored.width // 2, stored.height // 2))[3] == 255
    assert icon["mode"] == "disc"


def test_a_file_that_is_not_a_picture_is_skipped_with_its_reason_and_the_rest_kept(client):
    svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="9" height="9"/></svg>'
    answer = upload(client, ("good.png", glyph()), ("raw.svg", svg), ("fake.png", b"\x89PNG not really"),
                    ("heavy.png", b"\x89PNG" + b"0" * (iconlibrary.MAX_FILE_BYTES + 10)))

    assert [icon["name"] for icon in answer["added"]] == ["Good"]
    reasons = {item["name"]: item["reason"] for item in answer["skipped"]}
    assert set(reasons) == {"Raw", "Fake", "Heavy"}
    assert "512 KB" in reasons["Heavy"]
    assert not list(iconlibrary.library_dir().glob("*.svg"))


def test_a_picture_too_large_to_decode_is_refused(client, monkeypatch):
    monkeypatch.setattr("azimut.engine.maplayers.MAX_ICON_AREA", 40 * 40)

    answer = upload(client, ("big.png", glyph(size=(64, 64))))

    assert answer["added"] == [] and "too large" in answer["skipped"][0]["reason"]


def test_icons_can_be_renamed_regrouped_switched_and_removed(client):
    icon = imported(client)
    url = f"/api/icons/{icon['key']}"

    changed = client.patch(url, json={"name": "  Main   battle tank ", "group": "Armour", "mode": "image"}).json()
    assert (changed["name"], changed["group"], changed["mode"]) == ("Main battle tank", "Armour", "image")
    assert client.patch(url, json={"mode": "sticker"}).status_code == 422

    assert client.post("/api/icons/remove", json={"keys": [icon["key"]]}).json()["removed"] == 1
    assert client.get("/api/icons").json()["icons"] == []
    assert client.get(f"{url}.png").status_code == 404


def test_an_import_lands_in_the_group_it_was_sent_with(client):
    answer = upload(client, ("a.png", glyph()), ("b.png", painted()), groups=["Vehicles"])

    assert [icon["group"] for icon in answer["added"]] == ["Vehicles", iconlibrary.DEFAULT_GROUP]


def test_the_library_says_when_it_is_full(client, monkeypatch):
    monkeypatch.setattr(iconlibrary, "MAX_ICONS", 1)

    answer = upload(client, ("a.png", glyph()), ("b.png", painted()))

    assert len(answer["added"]) == 1
    assert "at most 1 icons" in answer["skipped"][0]["reason"]


def test_one_import_request_is_bounded(client, monkeypatch):
    monkeypatch.setattr("azimut.api.icons.MAX_FILES_PER_REQUEST", 1)

    response = client.post("/api/icons", files=[("files", ("a.png", glyph(), "image/png")),
                                                ("files", ("b.png", painted(), "image/png"))])

    assert response.status_code == 413


def test_the_settings_backup_carries_the_library_to_another_machine(client):
    icon = imported(client)
    client.patch(f"/api/icons/{icon['key']}", json={"name": "Tank", "group": "Armour", "mode": "image"})
    bundle = client.get("/api/settings/export").json()
    assert [entry["name"] for entry in bundle["icons"]] == ["Tank"]

    client.post("/api/icons/remove", json={"keys": [icon["key"]]})
    restored = client.post("/api/settings/import", json=bundle).json()

    assert restored["icons"] == 1
    [back] = client.get("/api/icons").json()["icons"]
    assert (back["key"], back["name"], back["group"], back["mode"]) == (icon["key"], "Tank", "Armour", "image")


def test_a_backup_icon_that_is_not_a_picture_is_dropped_not_the_whole_restore(client):
    bundle = {"settings": {"units": "imperial"},
              "icons": [{"name": "Bad", "png_base64": base64.b64encode(b"not a png").decode()},
                        {"name": "Good", "png_base64": base64.b64encode(glyph()).decode()}]}

    restored = client.post("/api/settings/import", json=bundle).json()

    assert restored["icons"] == 1 and "units" in restored["imported"]
    assert [icon["name"] for icon in client.get("/api/icons").json()["icons"]] == ["Good"]


# ---------------------------------------------------------------------------
# A layer keeps its own copy
# ---------------------------------------------------------------------------


def test_a_marker_in_a_library_icon_gives_its_layer_a_copy_that_outlives_the_library(client, owner):
    icon = imported(client)
    url, row = editable(client, owner)

    marker = client.post(f"{url}/markers", json={"lat": 48.85, "lon": 2.35, "icon": icon["key"]}).json()["marker"]

    assert marker["properties"]["icon"] == icon["key"]
    assert icon["key"] in zip_keys(owner, row)
    [drawn] = client.get(f"{url}/data").json()["features"]
    assert (drawn["properties"]["icon_mode"], drawn["properties"]["icon_name"]) == ("disc", "Tank")
    assert client.get(f"{url}/edit").json()["icons"] == {icon["key"]: {"mode": "disc", "name": "Tank"}}

    client.post("/api/icons/remove", json={"keys": [icon["key"]]})
    assert client.get(f"{url}/icons/{icon['key']}").status_code == 200
    assert client.get(f"{url}/data").json()["features"][0]["properties"]["icon"] == icon["key"]


def test_an_icon_that_is_nowhere_is_refused(client, owner):
    url, _ = editable(client, owner)

    response = client.post(f"{url}/markers", json={"lat": 1, "lon": 1, "icon": "0123456789abcdef"})

    assert response.status_code == 422
    assert "no longer in your library" in response.json()["detail"]
    assert client.post(f"{url}/markers", json={"lat": 1, "lon": 1, "icon": "../../etc"}).status_code == 422


def test_a_colour_pick_keeps_the_icon_and_a_symbol_pick_takes_it_off(client, owner):
    icon = imported(client)
    url, _ = editable(client, owner)
    key = client.post(f"{url}/markers", json={"lat": 1, "lon": 1, "icon": icon["key"]}).json()["marker"]["properties"]["key"]

    coloured = client.patch(f"{url}/markers/{key}", json={"colour": "#d55e00"}).json()["marker"]
    assert coloured["properties"]["icon"] == icon["key"]
    assert coloured["properties"]["colour"] == "#d55e00"

    selected = client.post(f"{url}/selection", json={"keys": [key], "changes": {"colour": "#009e73"}}).json()
    assert selected["document"]["features"][0]["properties"]["icon"] == icon["key"]

    plain = client.patch(f"{url}/markers/{key}", json={"symbol": "badge-tank"}).json()["marker"]
    assert plain["properties"]["icon"] == "" and plain["properties"]["symbol"] == "badge-tank"

    back = client.post(f"{url}/selection", json={"keys": [key], "changes": {"icon": icon["key"]}}).json()
    assert back["document"]["features"][0]["properties"]["icon"] == icon["key"]


def test_a_group_with_one_style_can_wear_an_icon(client, owner):
    icon = imported(client)
    url, _ = editable(client, owner)
    client.post(f"{url}/markers", json={"lat": 1, "lon": 1, "symbol": "star"})
    group = client.get(f"{url}/edit").json()["groups"][0]["id"]

    client.patch(f"{url}/groups/{group}", json={"mode": "uniform", "icon": icon["key"]})
    [drawn] = client.get(f"{url}/data").json()["features"]
    assert drawn["properties"]["icon"] == icon["key"]
    assert client.get(url).json()["categories"][0]["icon"] == icon["key"]

    client.patch(f"{url}/groups/{group}", json={"symbol": "badge-tank"})
    assert client.get(f"{url}/data").json()["features"][0]["properties"]["icon"] == ""
    assert "icon" not in client.get(f"{url}/edit").json()["groups"][0]


def test_picking_an_icon_again_brings_the_way_the_library_draws_it_now(client, owner):
    icon = imported(client)
    url, _ = editable(client, owner)
    key = client.post(f"{url}/markers", json={"lat": 1, "lon": 1, "icon": icon["key"]}).json()["marker"]["properties"]["key"]

    client.patch(f"/api/icons/{icon['key']}", json={"mode": "image"})
    assert client.get(f"{url}/data").json()["features"][0]["properties"]["icon_mode"] == "disc"
    client.patch(f"{url}/markers/{key}", json={"icon": icon["key"]})
    assert client.get(f"{url}/data").json()["features"][0]["properties"]["icon_mode"] == "image"


# ---------------------------------------------------------------------------
# A duplicated map and its icons
# ---------------------------------------------------------------------------


def dressed_kmz() -> bytes:
    """A map with its own pictogram inside it, the way a My Maps exports one."""
    kml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Dressed</name>'
        '<Style id="pin"><IconStyle><color>ff0000ff</color><scale>1</scale>'
        '<Icon><href>images/pin.png</href></Icon></IconStyle></Style>'
        "<Folder><name>Checkpoints</name>"
        '<Placemark><name>North gate</name><styleUrl>#pin</styleUrl>'
        "<Point><coordinates>2.35,48.85</coordinates></Point></Placemark>"
        "</Folder></Document></kml>"
    ).encode()
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("doc.kml", kml)
        archive.writestr("images/pin.png", glyph(colour=(255, 255, 255)))
    return buffer.getvalue()


@pytest.fixture
def source(client, owner, monkeypatch):
    def refuse(*args, **kwargs):
        raise AssertionError("adding a KMZ with its icons inside reached the network")

    monkeypatch.setattr(maplayers.httpx, "stream", refuse)
    response = client.post(f"/api/cases/{owner}/map-layers/upload",
                           files={"file": ("dressed.kmz", io.BytesIO(dressed_kmz()), "application/octet-stream")},
                           data={"title": "Dressed map", "icons": "true"})
    assert response.status_code == 200, response.text
    return response.json()


def test_a_copied_map_keeps_its_icons_and_a_colour_pick_no_longer_drops_them(client, owner, source):
    copy = client.post(f"/api/cases/{owner}/map-layers/{source['name']}/editable-copy", json={}).json()
    url = f"/api/cases/{owner}/map-layers/{copy['name']}"
    point = next(f for f in client.get(f"{url}/edit").json()["document"]["features"] if f["geometry"]["type"] == "Point")
    own = point["properties"]["icon"]
    assert own

    client.patch(f"{url}/markers/{point['properties']['key']}", json={"colour": "#000000"})

    after = next(f for f in client.get(f"{url}/data").json()["features"] if f["geometry"]["type"] == "Point")
    assert after["properties"]["icon"] == own and after["properties"]["icon_mode"] == "image"


def test_a_layer_lists_the_icons_it_holds_and_files_them_in_the_library(client, owner, source):
    url = f"/api/cases/{owner}/map-layers/{source['name']}"
    [held] = client.get(f"{url}/icons").json()

    assert held["count"] == 1 and held["name"] == "Checkpoints" and held["mode"] == "image"
    filed = client.post(f"{url}/icons/library", json={"keys": [held["key"]]}).json()
    [icon] = filed["added"]
    assert (icon["name"], icon["group"], icon["mode"]) == ("Checkpoints", "Dressed map", "image")
    assert held["digest"] in icon.get("aliases", [icon["key"]]) or held["digest"] == icon["key"]

    again = client.post(f"{url}/icons/library", json={"keys": [held["key"]]}).json()
    assert again["added"] == [] and again["already"] == 1


def test_a_point_copied_out_of_a_map_can_keep_its_own_icon(client, owner, source):
    own = client.get(f"/api/cases/{owner}/map-layers/{source['name']}/icons").json()[0]["key"]
    url, row = editable(client, owner, "Mine")

    marker = client.post(f"{url}/markers", json={"lat": 1, "lon": 1, "icon": own,
                                                  "icon_from": source["name"]}).json()["marker"]

    assert marker["properties"]["icon"] == own
    assert own in zip_keys(owner, row)
    assert client.get(f"{url}/icons/{own}").status_code == 200


def test_a_point_copied_from_a_map_that_lacks_the_icon_is_refused(client, owner, source):
    url, _ = editable(client, owner, "Mine")

    response = client.post(f"{url}/markers", json={"lat": 1, "lon": 1, "icon": "0123456789abcdef",
                                                    "icon_from": source["name"]})

    assert response.status_code == 422 and "no longer holds" in response.json()["detail"]


def test_a_kmz_download_carries_an_icon_as_the_map_draws_it(client, owner):
    icon = imported(client)
    url, _ = editable(client, owner)
    client.post(f"{url}/markers", json={"lat": 1, "lon": 1, "icon": icon["key"], "colour": "#d55e00"})
    disc = Image.new("RGBA", (64, 64), (213, 94, 0, 255))
    buffer = io.BytesIO()
    disc.save(buffer, "PNG")
    drawn_key = layerexports.icon_key(f"own-{icon['key']}", "#d55e00")

    response = client.post(f"{url}/export/kmz", json={"icons": {drawn_key: base64.b64encode(buffer.getvalue()).decode()}})

    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        [member] = [name for name in archive.namelist() if name.startswith("icons/")]
        sent = Image.open(io.BytesIO(archive.read(member)))
    assert sent.size == (64, 64) and sent.convert("RGBA").getpixel((5, 5)) == (213, 94, 0, 255)
