"""Satellite capture API: bearing is honored and persisted with provenance."""

from PIL import Image

from azimut.engine import tiles


def _fake_tile(client, url):  # offline: every tile is a solid green square
    return Image.new("RGB", (256, 256), (10, 120, 10))


def test_providers_flag_imagery_vs_street(client):
    # the UI uses `imagery` to disable the OSM labels overlay over street maps
    providers = {p["id"]: p for p in client.get("/api/satellite/providers").json()}
    assert providers["esri-world-imagery"]["imagery"] is True
    assert providers["osm"]["imagery"] is False


def test_capture_persists_bearing(client, monkeypatch):
    monkeypatch.setattr(tiles, "_default_fetch", _fake_tile)
    cid = client.post("/api/cases", json={"name": "Sat"}).json()["id"]

    result = client.post(
        f"/api/cases/{cid}/satellite/capture",
        json={"lat": 48.8584, "lon": 2.2945, "zoom": 16,
              "width": 640, "height": 480, "bearing": 90},
    ).json()
    assert result["bearing"] == 90.0

    listed = client.get(f"/api/cases/{cid}/satellite").json()
    assert len(listed) == 1
    assert listed[0]["bearing"] == 90.0


def test_capture_defaults_to_north(client, monkeypatch):
    monkeypatch.setattr(tiles, "_default_fetch", _fake_tile)
    cid = client.post("/api/cases", json={"name": "Sat"}).json()["id"]

    result = client.post(
        f"/api/cases/{cid}/satellite/capture",
        json={"lat": 48.8584, "lon": 2.2945, "zoom": 16, "width": 512, "height": 512},
    ).json()
    assert result["bearing"] == 0.0


def _capture(client, cid, lat, lon, zoom=16):
    return client.post(
        f"/api/cases/{cid}/satellite/capture",
        json={"lat": lat, "lon": lon, "zoom": zoom, "width": 512, "height": 512},
    ).json()


def _of_type(client, cid, etype):
    return [e for e in client.get(f"/api/cases/{cid}").json()["entities"]
            if e["type"] == etype]


def _captures(client, cid):
    return _of_type(client, cid, "capture")


def _places(client, cid):
    return _of_type(client, cid, "place")


def test_capture_creates_capture_entity_not_place(client, monkeypatch):
    monkeypatch.setattr(tiles, "_default_fetch", _fake_tile)
    cid = client.post("/api/cases", json={"name": "Sat"}).json()["id"]
    cap = _capture(client, cid, 48.8584, 2.2945)
    # a capture is an image entity, not a navigable place
    assert _places(client, cid) == []
    caps = _captures(client, cid)
    assert len(caps) == 1
    # the entity is tied to this exact capture by path, titled with its coords
    assert caps[0]["attrs"]["coords"] == "48.858400, 2.294500"
    assert caps[0]["attrs"]["path"] == cap["path"]
    assert caps[0]["label"] == "48.858400, 2.294500"
    assert caps[0]["attrs"]["zoom"] == 16
    assert caps[0]["attrs"]["bearing"] == 0.0
    # capturing files it straight away — no confirm step
    assert caps[0]["provenance"]["status"] == "confirmed"


def test_capture_lands_in_media_library(client, monkeypatch):
    monkeypatch.setattr(tiles, "_default_fetch", _fake_tile)
    cid = client.post("/api/cases", json={"name": "Sat"}).json()["id"]
    cap = _capture(client, cid, 48.8584, 2.2945)
    # a capture now lives in media/ so the Media Library lists it and Inspect can open it
    assert cap["path"].startswith("media/")
    media = client.get(f"/api/cases/{cid}/media").json()
    entry = next(m for m in media if m["path"] == cap["path"])
    assert entry["kind"] == "image"
    assert entry["source"]["type"] == "satellite"
    # it carries a thumbnail like any other media item
    assert entry["thumbnail"]


def test_capture_records_both_dates(client, monkeypatch):
    monkeypatch.setattr(tiles, "_default_fetch", _fake_tile)
    cid = client.post("/api/cases", json={"name": "Sat"}).json()["id"]
    result = client.post(
        f"/api/cases/{cid}/satellite/capture",
        json={"lat": 48.8584, "lon": 2.2945, "zoom": 16, "width": 512, "height": 512,
              "imagery_date": "2021-06-01"},
    ).json()
    # capture timestamp (when clicked) and imagery acquisition date (the scene)
    assert result["fetched_at"]  # ISO capture timestamp
    assert result["imagery_date"] == "2021-06-01"
    listed = client.get(f"/api/cases/{cid}/satellite").json()[0]
    assert listed["fetched_at"] == result["fetched_at"]
    assert listed["imagery_date"] == "2021-06-01"


def test_capture_imagery_date_optional(client, monkeypatch):
    monkeypatch.setattr(tiles, "_default_fetch", _fake_tile)
    cid = client.post("/api/cases", json={"name": "Sat"}).json()["id"]
    # no imagery date known → recorded as null, capture still succeeds
    result = _capture(client, cid, 48.8584, 2.2945)
    assert result["imagery_date"] is None


def test_imagery_date_non_esri_is_unsupported(client):
    out = client.get(
        "/api/satellite/imagery-date",
        params={"lat": 48.8584, "lon": 2.2945, "zoom": 16, "provider": "osm"},
    ).json()
    assert out == {"supported": False, "date": None, "source": None}


def test_imagery_date_esri_best_effort(client, monkeypatch):
    class _Resp:
        def raise_for_status(self):
            pass

        def json(self):
            return {"results": [{"attributes": {"NICE_NAME": "Maxar", "SRC_DATE2": "20200103"}}]}

    monkeypatch.setattr(tiles.httpx, "get", lambda *a, **k: _Resp())
    out = client.get(
        "/api/satellite/imagery-date",
        params={"lat": 48.8584, "lon": 2.2945, "zoom": 16},
    ).json()
    assert out == {"supported": True, "date": "2020-01-03", "source": "Maxar"}


def test_imagery_date_service_down_is_graceful(client, monkeypatch):
    def boom(*a, **k):
        raise OSError("down")

    monkeypatch.setattr(tiles.httpx, "get", boom)
    out = client.get(
        "/api/satellite/imagery-date",
        params={"lat": 0, "lon": 0, "zoom": 10},
    ).json()
    assert out == {"supported": True, "date": None, "source": None}


def test_save_place_creates_place_without_image(client):
    cid = client.post("/api/cases", json={"name": "Sat"}).json()["id"]
    place = client.post(
        f"/api/cases/{cid}/satellite/place",
        json={"lat": 48.8584, "lon": 2.2945, "zoom": 18, "bearing": 30},
    ).json()
    assert place["type"] == "place"
    assert place["label"] == "48.858400, 2.294500"
    # a bare place carries coordinates but no image path — nothing on disk
    assert "path" not in place["attrs"]
    assert place["attrs"]["zoom"] == 18 and place["attrs"]["bearing"] == 30
    assert len(_places(client, cid)) == 1
    assert _captures(client, cid) == []
    # no satellite image file was written
    assert client.get(f"/api/cases/{cid}/satellite").json() == []


def test_save_place_with_note(client):
    cid = client.post("/api/cases", json={"name": "Sat"}).json()["id"]
    place = client.post(
        f"/api/cases/{cid}/satellite/place",
        json={"lat": 48.8584, "lon": 2.2945, "title": "HQ", "notes": "  seen on video  "},
    ).json()
    assert place["label"] == "HQ"
    assert place["attrs"]["notes"] == "seen on video"


def test_edit_place_title_and_note_via_entity_patch(client):
    cid = client.post("/api/cases", json={"name": "Sat"}).json()["id"]
    place = client.post(
        f"/api/cases/{cid}/satellite/place",
        json={"lat": 48.8584, "lon": 2.2945},
    ).json()
    # the generic entity PATCH retitles and sets the note (used by the editor)
    updated = client.patch(
        f"/api/cases/{cid}/entities/{place['id']}",
        json={"label": "Command post", "attrs": {"notes": "north wall"}},
    ).json()
    assert updated["label"] == "Command post"
    assert updated["attrs"]["notes"] == "north wall"
    # coordinates are untouched by the merge
    assert updated["attrs"]["lat"] == 48.8584 and updated["attrs"]["lon"] == 2.2945


def test_save_place_honors_custom_title(client):
    cid = client.post("/api/cases", json={"name": "Sat"}).json()["id"]
    place = client.post(
        f"/api/cases/{cid}/satellite/place",
        json={"lat": 48.8584, "lon": 2.2945, "title": "  Eiffel Tower  "},
    ).json()
    assert place["label"] == "Eiffel Tower"
    assert place["attrs"]["coords"] == "48.858400, 2.294500"


def test_each_capture_is_its_own_entity(client, monkeypatch):
    monkeypatch.setattr(tiles, "_default_fetch", _fake_tile)
    cid = client.post("/api/cases", json={"name": "Sat"}).json()["id"]
    # two captures at the same coordinates are two independent entities (1:1)
    _capture(client, cid, 48.8584, 2.2945, zoom=16)
    _capture(client, cid, 48.8584, 2.2945, zoom=17)
    assert len(_captures(client, cid)) == 2


def test_delete_capture_removes_only_its_entity(client, monkeypatch):
    monkeypatch.setattr(tiles, "_default_fetch", _fake_tile)
    cid = client.post("/api/cases", json={"name": "Sat"}).json()["id"]
    first = _capture(client, cid, 48.8584, 2.2945, zoom=16)
    second = _capture(client, cid, 48.8584, 2.2945, zoom=17)

    client.delete(f"/api/cases/{cid}/satellite", params={"path": first["path"]})
    # only the deleted capture's entity is gone; the sibling stays intact
    caps = _captures(client, cid)
    assert len(caps) == 1
    assert caps[0]["attrs"]["path"] == second["path"]
    remaining = client.get(f"/api/cases/{cid}/satellite").json()
    assert [c["path"] for c in remaining] == [second["path"]]


def test_delete_capture_entity_removes_only_its_image(client, monkeypatch):
    monkeypatch.setattr(tiles, "_default_fetch", _fake_tile)
    cid = client.post("/api/cases", json={"name": "Sat"}).json()["id"]
    first = _capture(client, cid, 48.8584, 2.2945, zoom=16)
    second = _capture(client, cid, 48.8584, 2.2945, zoom=17)
    cap = next(c for c in _captures(client, cid) if c["attrs"]["path"] == first["path"])

    # deleting the capture row from the sidebar wipes just its one image
    client.delete(f"/api/cases/{cid}/entities/{cap['id']}")
    assert len(_captures(client, cid)) == 1
    remaining = client.get(f"/api/cases/{cid}/satellite").json()
    assert [c["path"] for c in remaining] == [second["path"]]


def test_delete_place_entity_leaves_captures_alone(client, monkeypatch):
    monkeypatch.setattr(tiles, "_default_fetch", _fake_tile)
    cid = client.post("/api/cases", json={"name": "Sat"}).json()["id"]
    cap = _capture(client, cid, 48.8584, 2.2945, zoom=16)
    client.post(
        f"/api/cases/{cid}/satellite/place",
        json={"lat": 48.8600, "lon": 2.3000},
    )
    place = _places(client, cid)[0]

    # a bare place has no image; deleting it must not touch capture files
    client.delete(f"/api/cases/{cid}/entities/{place['id']}")
    assert _places(client, cid) == []
    assert [c["path"] for c in client.get(f"/api/cases/{cid}/satellite").json()] == [cap["path"]]


def test_default_marker_is_centered_crosshair(client, monkeypatch):
    monkeypatch.setattr(tiles, "_default_fetch", _fake_tile)
    cid = client.post("/api/cases", json={"name": "Sat"}).json()["id"]
    result = _capture(client, cid, 48.8584, 2.2945)
    # marker defaults to the crop center; recorded coords == center
    assert result["marker_style"] == "crosshair"
    assert result["marker_x"] == 0 and result["marker_y"] == 0
    assert result["lat"] == 48.8584 and result["lon"] == 2.2945
    assert result["center_lat"] == 48.8584 and result["center_lon"] == 2.2945


def test_pin_style_persists(client, monkeypatch):
    monkeypatch.setattr(tiles, "_default_fetch", _fake_tile)
    cid = client.post("/api/cases", json={"name": "Sat"}).json()["id"]
    result = client.post(
        f"/api/cases/{cid}/satellite/capture",
        json={"lat": 48.8584, "lon": 2.2945, "zoom": 16,
              "width": 512, "height": 512, "marker_style": "pin"},
    ).json()
    assert result["marker_style"] == "pin"
    assert client.get(f"/api/cases/{cid}/satellite").json()[0]["marker_style"] == "pin"


def test_moved_marker_records_pin_coords_not_center(client, monkeypatch):
    monkeypatch.setattr(tiles, "_default_fetch", _fake_tile)
    cid = client.post("/api/cases", json={"name": "Sat"}).json()["id"]
    # crop framed on center, but the pin was dragged to a different point
    result = client.post(
        f"/api/cases/{cid}/satellite/capture",
        json={"lat": 48.8584, "lon": 2.2945, "zoom": 16, "width": 512, "height": 512,
              "marker_style": "pin", "marker_x": 0, "marker_y": 200,
              "marker_lat": 48.8600, "marker_lon": 2.3000},
    ).json()
    # recorded coordinates & offset follow the pin, center stays the frame
    assert (result["lat"], result["lon"]) == (48.86, 2.3)
    assert (result["center_lat"], result["center_lon"]) == (48.8584, 2.2945)
    assert result["marker_y"] == 200
    # the mirrored capture entity is titled/located at the pin, not the center
    cap = _captures(client, cid)[0]
    assert cap["attrs"]["lat"] == 48.86 and cap["attrs"]["lon"] == 2.3
    assert cap["label"] == "48.860000, 2.300000"


def test_no_marker_leaves_image_unmarked(client, monkeypatch):
    monkeypatch.setattr(tiles, "_default_fetch", _fake_tile)
    cid = client.post("/api/cases", json={"name": "Sat"}).json()["id"]
    result = client.post(
        f"/api/cases/{cid}/satellite/capture",
        json={"lat": 48.8584, "lon": 2.2945, "zoom": 16,
              "width": 256, "height": 256, "marker_style": "none"},
    ).json()
    assert result["marker_style"] == "none"
    assert result["crosshair"] is False


def test_edit_title_renames_capture_entity(client, monkeypatch):
    monkeypatch.setattr(tiles, "_default_fetch", _fake_tile)
    cid = client.post("/api/cases", json={"name": "Sat"}).json()["id"]
    cap = _capture(client, cid, 48.8584, 2.2945)

    updated = client.patch(
        f"/api/cases/{cid}/satellite",
        json={"path": cap["path"], "title": "Eiffel Tower"},
    ).json()
    assert updated["title"] == "Eiffel Tower"
    assert _captures(client, cid)[0]["label"] == "Eiffel Tower"

    # listing reflects the stored title
    listed = client.get(f"/api/cases/{cid}/satellite").json()
    assert listed[0]["title"] == "Eiffel Tower"

    # clearing the title falls back to the coordinates on both sides
    client.patch(f"/api/cases/{cid}/satellite", json={"path": cap["path"], "title": "  "})
    assert _captures(client, cid)[0]["label"] == "48.858400, 2.294500"
