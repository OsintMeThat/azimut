"""A saved Horizon view: kept to be opened again, standing on the map as saved work."""

import copy
import io

import pytest
from PIL import Image

from azimut import layout
from azimut.workspace import Case


def _png(color=(30, 60, 90), size=(96, 64)) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", size, color).save(out, "PNG")
    return out.getvalue()


def _case(client, name: str) -> str:
    return client.post("/api/cases", json={"name": name}).json()["id"]


def _photo(client, cid: str, name: str = "ridge.png") -> str:
    answer = client.post(
        f"/api/cases/{cid}/media/upload", files={"file": (name, io.BytesIO(_png()), "image/png")}
    )
    assert answer.status_code == 200, answer.text
    return answer.json()["item"]["path"]


def _spec(photo: str | None = None) -> dict:
    spec = {
        "version": 1,
        "eye": {"lat": 46.5586, "lon": 7.8353, "mode": "ground", "height": 1.7},
        "look": {"heading": 95.5, "tilt": 2, "roll": -1.5, "fov": 58, "projection": "camera"},
        "picture": {
            "ground": "imagery", "lines": True, "ridges": 3, "visibility": 40_000, "near": 300,
            "imagery": "esri-wayback~31144", "sentinel": {"reach": 5_000, "date": "2026-08-14"},
            "names": True, "shadows": 0.7,
        },
        "sky": {"on": True, "date": "2026-07-14", "time": "17:30"},
        "target": {"lat": 46.5775, "lon": 7.9853, "height": 10},
    }
    if photo:
        spec["photo"] = {
            "path": photo, "kind": "image", "title": "Ridge at dusk", "mix": 0.55, "bend": -0.08,
            "corners": [{"u": 0, "v": 0}, {"u": 1.05, "v": -0.02}, {"u": 1, "v": 1}, {"u": 0, "v": 1}],
            "strokes": [[{"u": 0.1, "v": 0.41}, {"u": 0.3, "v": 0.38}], []],
            "pins": [],
            "locked": True,
        }
    return spec


def _save(client, cid: str, title: str, spec: dict | None = None, **extra):
    return client.post(
        f"/api/cases/{cid}/horizon/views",
        json={
            "title": title,
            "spec": spec or _spec(),
            "made": {
                "terrain": [{"label": "Mapterhorn", "attribution": "© Mapterhorn"}],
                "resolution_m": 9.6, "refraction": 0.13, "ground_m": 2950, "altitude_m": 2951.7,
            },
            "footprint": [[7.8353, 46.5586], [7.98, 46.62], [8.0, 46.5]],
            **extra,
        },
    )


def _thumb(client, cid: str, name: str):
    return client.put(
        f"/api/cases/{cid}/horizon/views/{name}/thumb",
        files={"file": ("preview.png", io.BytesIO(_png(size=(160, 80))), "image/png")},
    )


def _row(client, cid: str, title: str) -> dict:
    rows = client.get(f"/api/cases/{cid}/satellite/index").json()
    return next(row for row in rows if row["title"] == title)


def test_a_view_comes_back_with_every_setting_and_what_the_terrain_was(client):
    cid = _case(client, "Views")
    photo = _photo(client, cid)
    saved = _save(client, cid, "North ridge", _spec(photo))
    assert saved.status_code == 200, saved.text
    assert saved.json()["spec_path"] == ".horizon/North ridge.json"

    loaded = client.get(f"/api/cases/{cid}/horizon/views/North ridge").json()
    assert loaded["azimut_horizon"] == 1 and loaded["app_version"]
    spec = loaded["spec"]
    assert spec["look"] == {"heading": 95.5, "tilt": 2, "roll": -1.5, "fov": 58, "projection": "camera"}
    assert spec["picture"]["imagery"] == "esri-wayback~31144"
    assert spec["picture"]["sentinel"] == {"reach": 5000, "date": "2026-08-14"}
    assert spec["sky"] == {"on": True, "date": "2026-07-14", "time": "17:30"}
    assert spec["target"]["height"] == 10
    # the photo and what was done to match it; an empty stroke is not kept
    assert spec["photo"]["path"] == photo and spec["photo"]["mix"] == 0.55
    assert spec["photo"]["corners"][1] == {"u": 1.05, "v": -0.02}
    assert spec["photo"]["locked"] is True
    assert spec["photo"]["strokes"] == [[{"u": 0.1, "v": 0.41}, {"u": 0.3, "v": 0.38}]]
    assert loaded["made"]["terrain"][0]["label"] == "Mapterhorn"
    assert loaded["made"]["resolution_m"] == 9.6
    assert loaded["photo_here"] is True and loaded["thumb"] is None

    listing = client.get(f"/api/cases/{cid}/horizon/views").json()
    assert [(v["name"], v["heading"], v["photo"]) for v in listing] == [("North ridge", 95.5, "Ridge at dusk")]


def test_a_view_stands_on_the_map_at_its_eye_facing_its_heading(client):
    cid = _case(client, "Views on the map")
    _save(client, cid, "North ridge")
    assert _thumb(client, cid, "North ridge").status_code == 200

    row = _row(client, cid, "North ridge")
    assert row["kind"] == "view" and row["view"] == "North ridge"
    assert (row["lat"], row["lon"]) == (46.5586, 7.8353)
    assert (row["heading"], row["fov"], row["projection"]) == (95.5, 58, "camera")
    # the map turned so the view's heading is up
    assert row["bearing"] == 264.5
    # the ground it took in, closed
    ring = row["footprint"]["coordinates"][0]
    assert ring[0] == ring[-1] and len(ring) == 4
    assert row["thumbnail"] == ".horizon/North ridge.webp"
    assert row["kept"] == []
    # its country is asked on save, and offline it waits for the Locate pass
    entity = Case.open(cid).find_entity(attr="spec", value=".horizon/North ridge.json")
    assert entity["type"] == "horizon-view"
    assert entity["attrs"]["geo"]["state"] == "failed"


def test_saving_again_keeps_one_view_and_renaming_carries_its_preview(client):
    cid = _case(client, "Renamed views")
    _save(client, cid, "North ridge")
    _thumb(client, cid, "North ridge")
    first = Case.open(cid).find_entity(attr="spec", value=".horizon/North ridge.json")

    assert _save(client, cid, "North ridge").status_code == 409
    turned = copy.deepcopy(_spec())
    turned["look"]["heading"] = 120
    assert _save(client, cid, "North ridge", turned, overwrite=True).status_code == 200

    renamed = _save(client, cid, "Eiger from the west", turned, rename_from="North ridge")
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["thumb"] == ".horizon/Eiger from the west.webp"
    case = Case.open(cid)
    entity = case.find_entity(attr="spec", value=".horizon/Eiger from the west.json")
    assert entity["id"] == first["id"] and entity["label"] == "Eiger from the west"
    assert entity["attrs"]["heading"] == 120
    assert entity["attrs"]["thumb"] == ".horizon/Eiger from the west.webp"
    assert not case.resolve_inside(".horizon/North ridge.json").exists()
    assert not case.resolve_inside(".horizon/North ridge.webp").exists()


def test_renaming_a_view_from_details_moves_its_file_and_preview(client):
    cid = _case(client, "Details rename")
    _save(client, cid, "North ridge")
    _thumb(client, cid, "North ridge")
    entity = Case.open(cid).find_entity(attr="spec", value=".horizon/North ridge.json")

    patched = client.patch(f"/api/cases/{cid}/entities/{entity['id']}", json={"label": "Mönch"})
    assert patched.status_code == 200, patched.text
    case = Case.open(cid)
    assert case.resolve_inside(".horizon/Mönch.json").is_file()
    assert case.resolve_inside(".horizon/Mönch.webp").is_file()
    after = case.get_entity(entity["id"])
    assert after["attrs"]["spec"] == ".horizon/Mönch.json"
    assert after["attrs"]["thumb"] == ".horizon/Mönch.webp"
    assert client.get(f"/api/cases/{cid}/horizon/views/Mönch").json()["title"] == "Mönch"


def test_a_deleted_view_goes_to_the_trash_and_its_name_waits_there(client):
    cid = _case(client, "Deleted views")
    _save(client, cid, "North ridge")
    _thumb(client, cid, "North ridge")
    deleted = client.delete(f"/api/cases/{cid}/horizon/views/North ridge")
    assert deleted.status_code == 200, deleted.text
    assert client.get(f"/api/cases/{cid}/horizon/views").json() == []
    assert not Case.open(cid).resolve_inside(".horizon/North ridge.webp").exists()

    # a new view does not take the name of one waiting in the Trash
    again = _save(client, cid, "North ridge")
    assert again.status_code == 200 and again.json()["name"] == "North ridge 2"


def test_a_view_on_a_photo_since_removed_still_opens_and_says_so(client):
    cid = _case(client, "Photo gone")
    photo = _photo(client, cid)
    _save(client, cid, "North ridge", _spec(photo))
    Case.open(cid).resolve_inside(photo).unlink()
    loaded = client.get(f"/api/cases/{cid}/horizon/views/North ridge").json()
    assert loaded["photo_here"] is False and loaded["spec"]["photo"]["path"] == photo


@pytest.mark.parametrize(
    "mutate",
    [
        lambda spec: spec["eye"].update(height=150),  # a person stands, a mast is a drone
        lambda spec: spec["eye"].update(lat=89),
        lambda spec: spec["look"].update(fov=200),  # a lens; the whole turn is a panorama
        lambda spec: spec["look"].update(heading=360),
        lambda spec: spec["picture"].update(imagery="nowhere"),
        lambda spec: spec["picture"].update(imagery="../esri"),
        lambda spec: spec["picture"].update(shadows=2),
        lambda spec: spec["sky"].update(time="25:00"),
        lambda spec: spec.update(version=2),
        lambda spec: spec.update(photo={"path": "media/missing.png", "kind": "image"}),
        lambda spec: spec.update(photo={"path": "../../etc/passwd", "kind": "image"}),
        lambda spec: spec.update(photo={"path": "media/x.png", "kind": "audio"}),
    ],
)
def test_a_view_refuses_what_it_could_not_open_again(client, mutate):
    cid = _case(client, "Refused views")
    spec = _spec()
    mutate(spec)
    assert _save(client, cid, "Refused", spec).status_code == 422


def test_a_footprint_is_points_on_the_earth(client):
    cid = _case(client, "Footprints")
    assert _save(client, cid, "Off", footprint=[[7.8, 46.5], [200, 46.6], [8.0, 46.5]]).status_code == 422
    assert _save(client, cid, "Short", footprint=[[7.8, 46.5], [7.9, 46.6]]).status_code == 422
    assert _save(client, cid, "None", footprint=None).status_code == 200
    assert _row(client, cid, "None")["footprint"] is None


def test_a_preview_is_a_picture_of_a_saved_view(client):
    cid = _case(client, "Previews")
    assert _thumb(client, cid, "Nothing").status_code == 404
    _save(client, cid, "North ridge")
    refused = client.put(
        f"/api/cases/{cid}/horizon/views/North ridge/thumb",
        files={"file": ("preview.png", io.BytesIO(b"not a picture"), "image/png")},
    )
    assert refused.status_code == 400
    assert _thumb(client, cid, "North ridge").json() == {"thumb": layout.horizon_thumb_rel("North ridge")}


def _keep(client, cid: str, name: str, kind: str = "view", data: bytes | None = None):
    return client.post(
        f"/api/cases/{cid}/horizon/views/{name}/images",
        files={"image": ("view.png", io.BytesIO(data or _png(size=(320, 200))), "image/png")},
        data={"kind": kind, "filename": f"{name} {kind}"},
    )


def test_a_kept_picture_stands_under_its_view_and_follows_a_rename(client):
    cid = _case(client, "Kept pictures")
    photo = _photo(client, cid)
    _save(client, cid, "North ridge", _spec(photo))
    kept = _keep(client, cid, "North ridge", "row")
    assert kept.status_code == 200, kept.text
    path = kept.json()["path"]
    assert path.startswith("media/") and path.endswith(".png")

    item = client.get(f"/api/cases/{cid}/media/item", params={"path": path}).json()
    source = item.get("source") or item.get("item", {}).get("source")
    assert source["type"] == "horizon" and source["kept"] is True and source["kind"] == "row"
    assert source["view"] == ".horizon/North ridge.json" and source["photo"] == photo
    # it comes from the photo, which is where a proof finds its source link
    assert source["from"] == photo
    assert _row(client, cid, "North ridge")["kept"][0]["path"] == path

    _save(client, cid, "Eiger from the west", _spec(photo), rename_from="North ridge")
    entity = Case.open(cid).find_entity(attr="path", value=path)
    assert entity["attrs"]["horizon_view"] == ".horizon/Eiger from the west.json"
    assert _row(client, cid, "Eiger from the west")["kept"][0]["path"] == path


def test_a_kept_picture_carries_the_credits_and_is_held_back_as_a_working_file(client):
    cid = _case(client, "Kept credits")
    _save(client, cid, "North ridge")
    kept = client.post(
        f"/api/cases/{cid}/horizon/views/North ridge/images",
        files={"image": ("view.png", io.BytesIO(_png(size=(320, 200))), "image/png")},
        data={"kind": "terrain", "filename": "North ridge terrain", "attribution": "© Mapterhorn · Esri"},
    )
    assert kept.status_code == 200, kept.text
    path = kept.json()["path"]
    item = client.get(f"/api/cases/{cid}/media/item", params={"path": path}).json()
    source = item.get("source") or item.get("item", {}).get("source")
    assert source["attribution"] == "© Mapterhorn · Esri"
    assert "from" not in source  # no photo, nothing it came from
    # the app made it: the Media Library holds it back with the other working files
    every = client.get(f"/api/cases/{cid}/media/page").json()
    assert any(row["path"] == path for row in every["items"])
    collected = client.get(f"/api/cases/{cid}/media/page", params={"collected_only": "true"}).json()
    assert all(row["path"] != path for row in collected["items"])
    assert collected["facets"]["made_here_count"] >= 1


def test_a_picture_is_kept_only_from_a_saved_view_and_only_as_a_picture(client):
    cid = _case(client, "Kept refused")
    assert _keep(client, cid, "Nothing").status_code == 404
    _save(client, cid, "North ridge")
    assert _keep(client, cid, "North ridge", data=b"not a picture").status_code == 422
    jpeg = io.BytesIO()
    Image.new("RGB", (40, 30)).save(jpeg, "JPEG")
    assert _keep(client, cid, "North ridge", data=jpeg.getvalue()).status_code == 422
    bad = client.post(
        f"/api/cases/{cid}/horizon/views/North ridge/images",
        files={"image": ("view.png", io.BytesIO(_png()), "image/png")},
        data={"kind": "poster", "filename": "x"},
    )
    assert bad.status_code == 422


def _capture(client, cid: str, data: bytes | None = None, **fields):
    form = {"filename": "Ridge capture", "lat": "46.5586", "lon": "7.8353", "heading": "95.5", "fov": "12.5", **fields}
    return client.post(
        f"/api/cases/{cid}/horizon/captures",
        files={"image": ("capture.png", io.BytesIO(data or _png(size=(320, 200))), "image/png")},
        data=form,
    )


def test_a_capture_is_filed_without_a_saved_view_and_says_where_it_stood(client):
    cid = _case(client, "Captures")
    taken = _capture(client, cid, area="true", attribution="© Mapterhorn")
    assert taken.status_code == 200, taken.text
    path = taken.json()["path"]
    assert path.startswith("media/") and path.endswith(".png")
    item = client.get(f"/api/cases/{cid}/media/item", params={"path": path}).json()
    source = item.get("source") or item.get("item", {}).get("source")
    assert source["type"] == "horizon" and source["kind"] == "capture" and source["area"] is True
    assert (source["lat"], source["lon"], source["heading"], source["fov"]) == (46.5586, 7.8353, 95.5, 12.5)
    assert source["attribution"] == "© Mapterhorn" and source["attribution_burned"] is True
    assert "view" not in source and "from" not in source
    entity = Case.open(cid).find_entity(attr="path", value=path)
    assert (entity["attrs"]["lat"], entity["attrs"]["lon"]) == (46.5586, 7.8353)
    assert "horizon_view" not in entity["attrs"]


def test_a_capture_names_the_saved_view_and_the_photo_it_shows(client):
    cid = _case(client, "Captured views")
    photo = _photo(client, cid)
    _save(client, cid, "North ridge", _spec(photo))
    taken = _capture(client, cid, view="North ridge", photo=photo)
    assert taken.status_code == 200, taken.text
    path = taken.json()["path"]
    item = client.get(f"/api/cases/{cid}/media/item", params={"path": path}).json()
    source = item.get("source") or item.get("item", {}).get("source")
    assert source["view"] == ".horizon/North ridge.json" and source["from"] == photo and source["area"] is False
    # listed under its view, as a kept picture is
    assert any(kept["path"] == path for kept in _row(client, cid, "North ridge")["kept"])


@pytest.mark.parametrize(
    "fields, status",
    [
        ({"view": "Never saved"}, 404),
        ({"photo": "media/nothing.png"}, 404),
        ({"photo": "../../outside.png"}, 403),
        ({"lat": "91"}, 422),
        ({"heading": "nan"}, 422),
        ({"fov": "0"}, 422),
        ({"filename": ""}, 422),
    ],
)
def test_a_capture_refuses_what_it_could_not_say(client, fields, status):
    cid = _case(client, "Captures refused")
    assert _capture(client, cid, **fields).status_code == status
    assert _capture(client, cid, data=b"not a picture").status_code == 422


def test_a_view_keeps_what_was_known_about_the_photo_and_the_reach_fit_found(client):
    cid = _case(client, "Hinted views")
    photo = _photo(client, cid)
    spec = _spec(photo)
    spec["photo"]["hints"] = {"zoom": "telephoto", "facing": {"heading": 218.4}, "reach": 10_000}
    spec["photo"]["reach"] = 20_000
    assert _save(client, cid, "Hinted", spec).status_code == 200
    kept = client.get(f"/api/cases/{cid}/horizon/views/Hinted").json()["spec"]["photo"]
    assert kept["hints"] == {"zoom": "telephoto", "facing": {"heading": 218.4}, "reach": 10_000}
    assert kept["reach"] == 20_000
    # a view saved before hints existed knows nothing about its photo
    plain = _spec(photo)
    assert _save(client, cid, "Plain", plain).status_code == 200
    kept = client.get(f"/api/cases/{cid}/horizon/views/Plain").json()["spec"]["photo"]
    assert kept["hints"] == {"zoom": "any", "facing": None, "reach": "auto"} and kept["reach"] is None


@pytest.mark.parametrize(
    "hints",
    [
        {"zoom": "huge"},
        {"reach": 12_345},  # not a reach the panorama keeps its skyline at
        {"reach": "far"},
        {"facing": {"heading": 360}},
    ],
)
def test_a_view_refuses_hints_fit_could_not_use(client, hints):
    cid = _case(client, "Refused hints")
    spec = _spec(_photo(client, cid))
    spec["photo"]["hints"] = hints
    assert _save(client, cid, "Refused", spec).status_code == 422
