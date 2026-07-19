"""Satellite capture API: bearing is honored and persisted with provenance."""

import pytest
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


def test_capture_title_follows_the_coordinate_format(client, monkeypatch):
    """A default title is minted in the user's format (Settings → Preferences),
    while the machine-readable fields stay in decimal degrees."""
    monkeypatch.setattr(tiles, "_default_fetch", _fake_tile)
    client.put("/api/settings/prefs", json={"coord_format": "mgrs"})
    cid = client.post("/api/cases", json={"name": "Sat"}).json()["id"]

    result = client.post(
        f"/api/cases/{cid}/satellite/capture",
        json={"lat": 48.8583701, "lon": 2.2944813, "zoom": 16, "width": 512, "height": 512},
    ).json()
    assert result["title"] == "31U DQ 48250 11951"

    listed = client.get(f"/api/cases/{cid}/satellite").json()[0]
    assert listed["title"] == "31U DQ 48250 11951"
    # provenance is never re-expressed: a later reader still gets the numbers
    assert listed["lat"] == pytest.approx(48.8583701)
    assert listed["lon"] == pytest.approx(2.2944813)
    entity = client.get(f"/api/cases/{cid}").json()["entities"][0]
    assert entity["attrs"]["coords"] == "48.858370, 2.294481"


def test_changing_the_format_never_rewrites_existing_titles(client, monkeypatch):
    """Titles are minted once. Switching format later renames nothing — the
    case keeps reading the way it was written."""
    monkeypatch.setattr(tiles, "_default_fetch", _fake_tile)
    cid = client.post("/api/cases", json={"name": "Sat"}).json()["id"]

    client.post(
        f"/api/cases/{cid}/satellite/capture",
        json={"lat": 48.8583701, "lon": 2.2944813, "zoom": 16, "width": 512, "height": 512},
    )
    assert client.get(f"/api/cases/{cid}/satellite").json()[0]["title"] == "48.858370, 2.294481"

    client.put("/api/settings/prefs", json={"coord_format": "dms"})
    # the old capture keeps its decimal title …
    assert client.get(f"/api/cases/{cid}/satellite").json()[0]["title"] == "48.858370, 2.294481"

    # … while a new one is titled the new way
    client.post(
        f"/api/cases/{cid}/satellite/capture",
        json={"lat": 40.6892, "lon": -74.0445, "zoom": 16, "width": 512, "height": 512},
    )
    titles = {c["title"] for c in client.get(f"/api/cases/{cid}/satellite").json()}
    assert titles == {"48.858370, 2.294481", "40°41'21.12\"N 74°02'40.20\"W"}


def test_place_label_follows_the_coordinate_format(client):
    client.put("/api/settings/prefs", json={"coord_format": "dms"})
    cid = client.post("/api/cases", json={"name": "Sat"}).json()["id"]

    place = client.post(
        f"/api/cases/{cid}/satellite/place",
        json={"lat": 48.8583701, "lon": 2.2944813, "zoom": 16},
    ).json()
    assert place["label"] == "48°51'30.13\"N 2°17'40.13\"E"
    assert place["attrs"]["coords"] == "48.858370, 2.294481"  # attrs stay decimal

    # an explicit title always wins over the derived one
    titled = client.post(
        f"/api/cases/{cid}/satellite/place",
        json={"lat": 48.8583701, "lon": 2.2944813, "zoom": 16, "title": "Rooftop"},
    ).json()
    assert titled["label"] == "Rooftop"


def _png_bytes(w=320, h=200, color=(30, 90, 30)):
    import io

    buf = io.BytesIO()
    Image.new("RGB", (w, h), color).save(buf, format="PNG")
    return buf.getvalue()


def test_widget_usage_endpoint_counts_map_loads(client):
    client.put("/api/settings/keys", json={"google_js": "AIza.js"})
    assert client.post("/api/satellite/usage/google_js").json()["count"] == 1
    assert client.post("/api/satellite/usage/google_js").json()["count"] == 2
    # tile meters are counted by the proxy, never by the browser
    assert client.post("/api/satellite/usage/google").status_code == 404
    assert client.post("/api/satellite/usage/nope").status_code == 404


def test_screenshot_capture_files_with_burned_attribution(client):
    client.put("/api/settings/keys", json={"google_js": "AIza.js"})
    cid = client.post("/api/cases", json={"name": "Sat"}).json()["id"]

    r = client.post(
        f"/api/cases/{cid}/satellite/screenshot",
        files={"image": ("shot.png", _png_bytes(), "image/png")},
        data={"lat": "48.8584", "lon": "2.2945", "zoom": "18",
              "provider": "google-js", "bearing": "45"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["method"] == "screenshot"
    assert "Google" in body["attribution"]
    assert body["attribution_burned"] is True
    # the footer band grew the image — attribution is pixels, not metadata
    assert body["height"] == 200 + tiles.ATTRIBUTION_BAND

    listed = client.get(f"/api/cases/{cid}/satellite").json()
    assert len(listed) == 1
    assert listed[0]["method"] == "screenshot"
    assert listed[0]["bearing"] == 45.0
    # nothing said it was framed, so provenance must not imply the coordinates
    # are a crop centre
    assert body["framed"] is False


def test_screenshot_provenance_distinguishes_a_framed_crop_from_a_pasted_image(client):
    """A screen crop taken through the capture frame is registered — its
    lat/lon *are* the crop centre — while a pasted screenshot's coordinates are
    only the map view at filing time. Provenance has to tell them apart, or a
    reader can't know what the coordinates mean."""
    client.put("/api/settings/keys", json={"google_js": "AIza.js"})
    cid = client.post("/api/cases", json={"name": "Sat"}).json()["id"]

    framed = client.post(
        f"/api/cases/{cid}/satellite/screenshot",
        files={"image": ("shot.png", _png_bytes(), "image/png")},
        data={"lat": "48.8584", "lon": "2.2945", "zoom": "18",
              "provider": "google-js", "framed": "true"},
    ).json()
    assert framed["framed"] is True

    pasted = client.post(
        f"/api/cases/{cid}/satellite/screenshot",
        files={"image": ("shot.png", _png_bytes(), "image/png")},
        data={"lat": "48.8584", "lon": "2.2945", "zoom": "18",
              "provider": "google-js", "framed": "false"},
    ).json()
    assert pasted["framed"] is False
    # both are still screenshots: framing never upgrades the method
    assert framed["method"] == pasted["method"] == "screenshot"

    listed = client.get(f"/api/cases/{cid}/satellite").json()
    assert sorted(c["framed"] for c in listed) == [False, True]


def test_screenshot_capture_refused_for_tile_providers(client):
    # tile providers have the real, pixel-registered capture path — routing a
    # screenshot around it would only launder away provenance
    cid = client.post("/api/cases", json={"name": "Sat"}).json()["id"]
    r = client.post(
        f"/api/cases/{cid}/satellite/screenshot",
        files={"image": ("shot.png", _png_bytes(), "image/png")},
        data={"lat": "0", "lon": "0", "zoom": "10", "provider": "esri-world-imagery"},
    )
    assert r.status_code == 422


def test_tile_proxy_rejects_out_of_range_coordinates(client):
    # a negative z used to reach `1 << z` and 500; bad input is a 422, not a crash
    assert client.get("/api/tiles/esri-world-imagery/-1/0/0").status_code == 422
    assert client.get("/api/tiles/esri-world-imagery/2/4/0").status_code == 422
    assert client.get("/api/tiles/esri-world-imagery/2/0/-1").status_code == 422


def test_tile_proxy_reuses_one_pooled_client(client, monkeypatch):
    """Every tile goes through one shared, keep-alive client — not a fresh
    connection per tile. Several tiles must hit the same client instance."""
    import httpx

    from azimut.api import satellite

    seen: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(id(request))
        return httpx.Response(200, content=_png_bytes(), headers={"content-type": "image/png"})

    pooled = httpx.Client(transport=httpx.MockTransport(handler))
    monkeypatch.setattr(satellite, "_tile_client", pooled)
    # spy: the route must fetch through the pooled client, never httpx.get
    monkeypatch.setattr(httpx, "get", lambda *a, **k: pytest.fail("used a one-shot connection"))

    calls = {"n": 0}
    real_get = pooled.get

    def counting_get(*a, **k):
        calls["n"] += 1
        return real_get(*a, **k)

    monkeypatch.setattr(pooled, "get", counting_get)

    for x in (16600, 16601, 16602):
        r = client.get(f"/api/tiles/esri-world-imagery/15/{x}/11278")
        assert r.status_code == 200
    assert calls["n"] == 3  # three tiles, all served by the one pooled client


def test_tile_proxy_benches_google_on_a_persistent_403(client, monkeypatch):
    """A 403 that survives the session re-mint names the key (EEA policy,
    revoked key) — the basemap must stop being offered, with Google's own
    sentence stored as the reason."""
    import httpx

    from azimut.api import satellite
    from azimut.engine import google_tiles

    client.put("/api/settings/keys", json={"google": "AIza.x"})
    monkeypatch.setattr(
        google_tiles, "resolve_template", lambda url, **kw: url.replace("{session}", "tok")
    )
    monkeypatch.setattr(google_tiles, "invalidate", lambda key: None)
    eea = (
        b'{"error": {"code": 403, "status": "PERMISSION_DENIED", "message": '
        b'"Satellite tiles are not available for your account and region."}}'
    )

    def forbidden(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            403, content=eea, headers={"content-type": "application/json"},
        )

    # the tile proxy pools one shared client; swap in one with a mock transport
    monkeypatch.setattr(
        satellite, "_tile_client", httpx.Client(transport=httpx.MockTransport(forbidden))
    )
    r = client.get("/api/tiles/google-satellite/15/16597/11278")
    assert r.status_code == 403  # passthrough, as before

    status = client.get("/api/settings").json()["provider_status"]["google"]
    assert status["ok"] is False
    assert "not available for your account and region" in status["detail"]
    ids = {p["id"] for p in client.get("/api/satellite/providers").json()}
    assert "google-satellite" not in ids


# --- Grid Search: several saved grids per case (spec §5) -------------------


def _rect_grid(south=48.0, west=2.0, north=48.02, east=2.02, statuses=None, title=None):
    return {
        "title": title,
        "spec": {
            "azimut_grid": 1,
            "cell_m": 500,
            "anchor": {"lat": south, "lon": west},
            "lat_step": 0.0045,
            "lon_step": 0.0067,
            "aoi": {"type": "rect", "bounds": {
                "south": south, "west": west, "north": north, "east": east}},
            "statuses": statuses or {},
        },
    }


def test_search_grids_empty_list(client):
    cid = client.post("/api/cases", json={"name": "Grid"}).json()["id"]
    assert client.get(f"/api/cases/{cid}/search-grids").json() == []


def test_search_grid_save_and_reload(client):
    cid = client.post("/api/cases", json={"name": "Grid"}).json()["id"]
    body = _rect_grid(statuses={"0:0": "cleared", "1:2": "flagged"}, title="North sweep")
    saved = client.put(f"/api/cases/{cid}/search-grids/north-sweep", json=body).json()
    assert saved["name"] == "north-sweep"
    assert saved["title"] == "North sweep"
    assert saved["updated_at"]

    loaded = client.get(f"/api/cases/{cid}/search-grids/north-sweep").json()
    assert loaded["cell_m"] == 500
    assert loaded["aoi"]["type"] == "rect"
    assert loaded["statuses"] == {"0:0": "cleared", "1:2": "flagged"}
    assert loaded["azimut_grid"] == 1
    assert loaded["title"] == "North sweep"
    assert loaded["created_at"]


def test_search_grids_list_summaries(client):
    cid = client.post("/api/cases", json={"name": "Grid"}).json()["id"]
    client.put(f"/api/cases/{cid}/search-grids/a",
               json=_rect_grid(statuses={"0:0": "cleared"}, title="A"))
    client.put(f"/api/cases/{cid}/search-grids/b",
               json=_rect_grid(statuses={"0:0": "flagged", "0:1": "flagged"}, title="B"))
    listed = {g["name"]: g for g in client.get(f"/api/cases/{cid}/search-grids").json()}
    assert set(listed) == {"a", "b"}
    assert listed["a"]["cleared"] == 1
    assert listed["b"]["flagged"] == 2
    assert listed["a"]["aoi_type"] == "rect"


def test_search_grid_replace_keeps_created_at(client):
    cid = client.post("/api/cases", json={"name": "Grid"}).json()["id"]
    client.put(f"/api/cases/{cid}/search-grids/g", json=_rect_grid())
    first = client.get(f"/api/cases/{cid}/search-grids/g").json()["created_at"]

    body = _rect_grid(north=48.05, east=48.05, statuses={"3:3": "cleared"})
    body["spec"]["created_at"] = first  # the client round-trips it back
    client.put(f"/api/cases/{cid}/search-grids/g", json=body)
    again = client.get(f"/api/cases/{cid}/search-grids/g").json()
    assert again["created_at"] == first
    assert again["statuses"] == {"3:3": "cleared"}


def test_search_grid_sanitizes_bad_statuses(client):
    cid = client.post("/api/cases", json={"name": "Grid"}).json()["id"]
    body = _rect_grid(statuses={"0:0": "cleared", "0:1": "bogus", "0:2": "flagged"})
    client.put(f"/api/cases/{cid}/search-grids/g", json=body)
    loaded = client.get(f"/api/cases/{cid}/search-grids/g").json()
    assert loaded["statuses"] == {"0:0": "cleared", "0:2": "flagged"}


def test_search_grid_rejects_missing_aoi(client):
    cid = client.post("/api/cases", json={"name": "Grid"}).json()["id"]
    r = client.put(f"/api/cases/{cid}/search-grids/g", json={"spec": {"cell_m": 500}})
    assert r.status_code == 400


def test_search_grid_missing_is_404(client):
    cid = client.post("/api/cases", json={"name": "Grid"}).json()["id"]
    assert client.get(f"/api/cases/{cid}/search-grids/nope").status_code == 404


def test_search_grid_delete_one(client):
    cid = client.post("/api/cases", json={"name": "Grid"}).json()["id"]
    client.put(f"/api/cases/{cid}/search-grids/a", json=_rect_grid(title="A"))
    client.put(f"/api/cases/{cid}/search-grids/b", json=_rect_grid(title="B"))
    assert client.delete(f"/api/cases/{cid}/search-grids/a").json()["deleted"] is True
    names = {g["name"] for g in client.get(f"/api/cases/{cid}/search-grids").json()}
    assert names == {"b"}
    # deleting again is a no-op, not an error
    assert client.delete(f"/api/cases/{cid}/search-grids/a").json()["deleted"] is False


def test_search_grids_are_not_entities(client):
    cid = client.post("/api/cases", json={"name": "Grid"}).json()["id"]
    client.put(f"/api/cases/{cid}/search-grids/g", json=_rect_grid())
    # grids are working aids, filed under search/, never in the case graph
    assert client.get(f"/api/cases/{cid}").json()["entities"] == []
