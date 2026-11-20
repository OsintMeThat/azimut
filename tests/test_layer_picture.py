"""A personal feature's own picture (`picture`, `engine/layerlinks.py`): a file, a capture or
a proof of the case its card shows, the marker keeping its own point. The editor's field
sets it, every map that draws the feature's card shows it, and it answers to the delete
preview, the Media library's Unused filter, the Trash and the bundle."""

import base64
import json
import re

import pytest

from azimut.engine import bundles, layerediting, layerlinks, notes_html, notes_web, workqueue
from azimut.workspace import Case
from mediafixture import _png_bytes, _upload


@pytest.fixture
def owner(client):
    return client.post("/api/cases", json={"name": "Layer pictures"}).json()["id"]


def create(client, owner, title="Vehicles"):
    response = client.post(f"/api/cases/{owner}/map-layers/editable", json={"title": title})
    assert response.status_code == 200, response.text
    return response.json()


def url_of(owner, row):
    return f"/api/cases/{owner}/map-layers/{row['name']}"


def add(client, owner, row, **fields):
    response = client.post(f"{url_of(owner, row)}/markers", json={"lat": 12.745, "lon": 43.495, **fields})
    assert response.status_code == 200, response.text
    return response.json()["marker"]["properties"]["key"]


def edit(client, owner, row, key, **changes):
    return client.patch(f"{url_of(owner, row)}/markers/{key}", json=changes)


def edited(client, owner, row):
    """The features as the editor reads them."""
    return {f["properties"]["key"]: f for f in client.get(f"{url_of(owner, row)}/edit").json()["document"]["features"]}


def drawn(client, owner, row):
    """The features as a map draws them."""
    return {f["properties"]["key"]: f for f in client.get(f"{url_of(owner, row)}/data").json()["features"]}


def stored(owner, row):
    case = Case.open(owner)
    return {f["properties"]["key"]: f["properties"] for f in layerediting._spec(case, row["name"])["document"]["features"]}


def entity_of(owner, path):
    return Case.open(owner).find_entity(attr="path", value=path)


def _map_data(document: bytes) -> dict:
    found = re.findall(r'<script type="application/json" class="az-map-data">(.*?)</script>', document.decode("utf-8"), re.S)
    return json.loads(found[0])


def test_a_feature_shows_a_picture_of_the_case_in_its_card_and_keeps_its_own_point(client, owner):
    path = _upload(client, owner, "Vehicle 07.png")
    crop = entity_of(owner, path)
    row = create(client, owner)
    key = add(client, owner, row, name="#7")

    answer = edit(client, owner, row, key, picture=crop["id"])
    assert answer.status_code == 200, answer.text
    said = answer.json()["marker"]["properties"]
    # the editor is told at once what its card shows
    assert (said["picture"], said["picture_label"], said["picture_type"]) == (crop["id"], crop["label"], "media")
    assert client.get(f"/files/{owner}/{said['picture_path']}").status_code == 200
    # the marker stays where it was put: a file with no point of its own moves nothing
    for read in (edited(client, owner, row), drawn(client, owner, row)):
        assert read[key]["geometry"]["coordinates"] == [43.495, 12.745]
        assert read[key]["properties"]["picture_path"] == said["picture_path"]
        assert "entity_id" not in read[key]["properties"]
    # what is kept is the id alone
    kept = stored(owner, row)[key]
    assert kept["picture"] == crop["id"]
    assert not set(layerlinks.PICTURE_SHOWN) & set(kept)

    # sending nothing takes it off
    assert edit(client, owner, row, key, picture=None).status_code == 200
    assert "picture" not in stored(owner, row)[key]
    assert "picture_path" not in drawn(client, owner, row)[key]["properties"]


def test_a_capture_and_a_proof_can_be_a_cards_picture_and_anything_else_is_refused(client, owner):
    row = create(client, owner)
    key = add(client, owner, row, name="#7")
    case = Case.open(owner)
    case.resolve_inside("media/gate.png").write_bytes(_png_bytes((40, 80, 40)))
    capture = case.add_entity("capture", "Gate", {"path": "media/gate.png", "kind": "image"}, by="test")
    proof = client.post(f"/api/cases/{owner}/proofs", json={
        "title": "Gate proof", "spec": {"panels": []}, "png_base64": base64.b64encode(_png_bytes()).decode()})
    assert proof.status_code == 200, proof.text
    for item, kind in ((capture["id"], "capture"), (proof.json()["id"], "proof")):
        answer = edit(client, owner, row, key, picture=item)
        assert answer.status_code == 200, answer.text
        assert answer.json()["marker"]["properties"]["picture_type"] == kind
        assert drawn(client, owner, row)[key]["properties"]["picture_path"]

    place = client.post(f"/api/cases/{owner}/satellite/place", json={"lat": 12.7, "lon": 43.5}).json()
    audio = case.add_entity("media", "Radio", {"path": "media/radio.mp3", "kind": "audio"}, by="test")
    for refused in (place["id"], audio["id"], "e_0000000000"):
        answer = edit(client, owner, row, key, picture=refused)
        assert answer.status_code == 422, refused
        assert "picture" in answer.json()["detail"]
    assert edit(client, owner, row, key, picture="../media/x.png").status_code == 422
    # the last one set still stands
    assert stored(owner, row)[key]["picture"] == proof.json()["id"]


def test_a_picture_wins_over_what_a_followed_item_shows_on_the_satellite_card(client, owner):
    footage = _upload(client, owner, "footage.png", (20, 90, 20))
    place = client.post(f"/api/cases/{owner}/satellite/place", json={"lat": 12.745, "lon": 43.495}).json()
    row = create(client, owner)
    linked = client.post(f"{url_of(owner, row)}/links", json={"items": [{"id": place["id"], "lat": 12.745, "lon": 43.495}]})
    assert linked.status_code == 200, linked.text
    [key] = drawn(client, owner, row)
    crop = entity_of(owner, footage)
    assert edit(client, owner, row, key, picture=crop["id"]).status_code == 200
    said = drawn(client, owner, row)[key]["properties"]
    # it still follows its place, and names its picture beside
    assert (said["entity_id"], said["picture"]) == (place["id"], crop["id"])
    assert said["picture_path"]


def test_a_note_map_card_shows_the_picture_and_a_followed_items_picture_gives_way(client, owner):
    case = Case.open(owner)
    first = entity_of(owner, _upload(client, owner, "Vehicle 07.png", (20, 20, 200)))
    plate = client.post(f"/api/cases/{owner}/proofs", json={
        "title": "Where it stands", "png_base64": base64.b64encode(_png_bytes((10, 10, 10))).decode(),
        "spec": {"panels": [], "points": [{"coords": "12.745, 43.495"}], "coordsText": "12.745, 43.495"}})
    assert plate.status_code == 200, plate.text
    row = create(client, owner)
    alone = add(client, owner, row, name="#7", description="Oshkosh M-ATV (identified)")
    linked = client.post(f"{url_of(owner, row)}/links", json={"items": [{"id": plate.json()["id"], "lat": 12.745, "lon": 43.495}]})
    assert linked.status_code == 200, linked.text
    follower = next(key for key in drawn(client, owner, row) if key != alone)
    second = entity_of(owner, _upload(client, owner, "Vehicle 08.png", (200, 200, 20)))
    for key, picture in ((alone, first), (follower, second)):
        assert edit(client, owner, row, key, picture=picture["id"]).status_code == 200

    text = f"# Map\n\n::: map\ntitle: Vehicles\nlayer: {row['name']}\n:::\n"
    data = _map_data(notes_html.render(case, title="Map", text=text).html)
    cards = {feature["card"]["title"]: feature["card"] for feature in data["features"]}
    assert cards["#7"]["media"]["alt"] == first["label"]
    assert cards["#7"]["media"]["src"].startswith("data:image/")
    # the proof the second follows had its plate in the card: the picture named wins
    followed = next(card for title, card in cards.items() if title != "#7")
    assert followed["media"]["alt"] == second["label"]
    assert not any(key in feature for feature in data["features"] for key in ("entity", "picture"))

    # the web folder, whose live map reads the same cards, keeps the picture as a file of its own
    folder = notes_html.Folder(csp=notes_web.folder_csp())
    page = notes_html.render(case, title="Map", text=text, public=True, folder=folder).html
    lifted = {feature["card"]["title"]: feature["card"]["media"]["src"] for feature in _map_data(page)["features"]}
    assert lifted["#7"] in folder.files
    # a map asked to show no picture in its cards shows none
    bare = f"# Map\n\n::: map\ntitle: Vehicles\nlayer: {row['name']}\ncard: sentence\n:::\n"
    assert all("media" not in feature["card"] for feature in _map_data(notes_html.render(case, title="Map", text=bare).html)["features"])


def test_a_picture_is_a_use_of_its_file_counted_by_marker(client, owner):
    path = _upload(client, owner, "Vehicle 07.png")
    spare = _upload(client, owner, "spare.png", (10, 200, 10))
    crop = entity_of(owner, path)
    row = create(client, owner, "Vehicles by kind")

    def touched():
        impact = client.post(f"/api/cases/{owner}/delete-impact", json={"ids": [crop["id"]]})
        assert impact.status_code == 200, impact.text
        return {held["label"]: held["how"] for held in impact.json()["touched"]}

    def unused():
        page = client.get(f"/api/cases/{owner}/media/page", params={"unused": "true"}).json()
        return sorted(item["path"] for item in page["items"])

    assert unused() == sorted([path, spare])
    first = add(client, owner, row, name="#7", picture=crop["id"])
    assert touched() == {"Vehicles by kind": ["1 marker shows it in its card"]}
    assert unused() == [spare]
    add(client, owner, row, name="#7 again", picture=crop["id"])
    assert touched() == {"Vehicles by kind": ["2 markers show it in their cards"]}
    edit(client, owner, row, first, picture=None)
    assert touched() == {"Vehicles by kind": ["1 marker shows it in its card"]}


def test_a_picture_in_the_trash_leaves_the_card_without_one_and_comes_back_with_it(client, owner):
    path = _upload(client, owner, "Vehicle 07.png")
    crop = entity_of(owner, path)
    row = create(client, owner)
    key = add(client, owner, row, name="#7", picture=crop["id"])
    before = client.get(f"/api/cases/{owner}/map-layers").json()
    sha = next(layer["sha256"] for layer in before if layer["name"] == row["name"])
    assert drawn(client, owner, row)[key]["properties"]["picture_path"]

    group = client.delete(f"/api/cases/{owner}/entities/{crop['id']}").json()["trash"]
    gone = next(layer["sha256"] for layer in client.get(f"/api/cases/{owner}/map-layers").json()
                if layer["name"] == row["name"])
    # the drawing is asked for again, and draws no picture
    assert gone != sha
    for read in (drawn(client, owner, row), edited(client, owner, row)):
        assert not {"picture", *layerlinks.PICTURE_SHOWN} & set(read[key]["properties"])
    assert stored(owner, row)[key]["picture"] == crop["id"]
    case = Case.open(owner)
    text = f"::: map\nlayer: {row['name']}\n:::\n"
    assert all("media" not in feature["card"] for feature in _map_data(notes_html.render(case, title="Map", text=text).html)["features"])

    assert client.post(f"/api/cases/{owner}/trash/{group}/restore").status_code == 200
    back = drawn(client, owner, row)[key]["properties"]
    assert back["picture"] == crop["id"] and back["picture_path"]
    assert client.get(f"/files/{owner}/{back['picture_path']}").status_code == 200


def test_an_undo_putting_a_drawn_feature_back_keeps_the_id_alone(client, owner):
    crop = entity_of(owner, _upload(client, owner, "Vehicle 07.png"))
    row = create(client, owner)
    key = add(client, owner, row, name="#7", picture=crop["id"])
    feature = edited(client, owner, row)[key]
    assert feature["properties"]["picture_path"]
    answer = client.post(f"{url_of(owner, row)}/revert", json={"put": [feature], "drop": []})
    assert answer.status_code == 200, answer.text
    assert not set(layerlinks.PICTURE_SHOWN) & set(stored(owner, row)[key])
    assert stored(owner, row)[key]["picture"] == crop["id"]


def test_a_full_cases_card_picture_travels_in_its_bundle(client):
    import fullcase

    full = fullcase.build_full_case(client)
    case = Case.open(full.case_id)
    name = full.editable_layer.rsplit("/", 1)[-1].removesuffix(".json")
    exported = bundles.export_case(case)
    destination = Case.create(bundles.imported_name(case.id))
    landed = Case.open(bundles.import_into(destination, exported)["case_id"])
    # the thumbnails a bundle leaves behind are made again
    workqueue.drain(landed)
    features = layerediting.read(landed, name)["document"]["features"]
    review = next(feature["properties"] for feature in features if feature["properties"].get("name") == "Review point")
    assert (review["picture"], review["picture_label"]) == (case.find_entity(attr="path", value=full.photo)["id"],
                                                            case.find_entity(attr="path", value=full.photo)["label"])
    assert client.get(f"/files/{landed.id}/{review['picture_path']}").status_code == 200
