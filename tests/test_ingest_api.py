"""The capture extension's ingest API (api/ingest.py).

What must hold: nothing files without the pairing token, what files rides the
normal capture pipeline (entity + provenance + burned attribution), and the
CORS opening is exactly extension origins on exactly /api/ingest/* — the token
guards against local callers, CORS against web pages, and each test pins one
of those walls.
"""

import io

import graph_read

from PIL import Image

from azimut.engine import tiles


def _png_bytes(w=320, h=200, color=(30, 90, 30)):
    buf = io.BytesIO()
    Image.new("RGB", (w, h), color).save(buf, format="PNG")
    return buf.getvalue()


def _token(client):
    # minting is an explicit user action (POST), never a side effect of opening
    # Settings — see mint_ingest_token in api/settings.py
    return client.post("/api/settings/ingest-token").json()["ingest_token"]


def _post(client, token=None, **overrides):
    data = {
        "url": "https://www.google.com/maps/@48.8584,2.2945,17z",
        "lat": "48.8584",
        "lon": "2.2945",
        "zoom": "17",
    }
    files = {"image": ("shot.png", overrides.pop("image", _png_bytes()), "image/png")}
    data.update(overrides)
    data = {k: v for k, v in data.items() if v is not None}
    headers = {"X-Azimut-Token": token} if token else {}
    return client.post("/api/ingest/screenshot", files=files, data=data, headers=headers)


def test_token_is_minted_once_and_survives_reads(client):
    # opening Settings must not mint a credential — only the explicit POST does
    assert client.get("/api/settings").json()["ingest_token"] == ""
    token = _token(client)
    assert len(token) >= 24
    assert _token(client) == token  # stable across reads — pairing must not churn
    # once minted, it does show up in Settings
    assert client.get("/api/settings").json()["ingest_token"] == token


def test_rotation_orphans_the_old_token(client):
    old = _token(client)
    new = client.post("/api/settings/ingest-token/rotate").json()["ingest_token"]
    assert new != old
    assert _post(client, token=old).status_code == 401
    assert _post(client, token=new).status_code == 200


def test_every_ingest_route_requires_the_token(client):
    _token(client)  # ensure one is minted — an unminted token must also refuse
    assert _post(client).status_code == 401
    assert _post(client, token="wrong").status_code == 401
    assert client.get("/api/ingest/ping").status_code == 401
    assert client.get("/api/ingest/cases").status_code == 401
    assert client.get("/api/ingest/ping", headers={"X-Azimut-Token": _token(client)}).json()[
        "app"
    ] == "azimut"


def test_screenshot_files_as_a_capture_with_provenance(client):
    token = _token(client)
    cid = client.post("/api/cases", json={"name": "Ingest"}).json()["id"]
    r = _post(client, token=token, case_id=cid)
    assert r.status_code == 200
    body = r.json()
    assert body["case_id"] == cid
    assert body["method"] == "screenshot"
    assert body["framed"] is False  # URL-derived view coords, not a crop frame
    assert body["site"] == "google-maps"
    assert body["source_url"].startswith("https://www.google.com/maps/")
    assert body["attribution"] == "Map data © Google"
    assert body["attribution_burned"] is True
    # the footer band grew the image — attribution is pixels, not metadata
    assert body["height"] == 200 + tiles.ATTRIBUTION_BAND
    # it lists with the case's other captures, coordinates intact
    listed = client.get(f"/api/cases/{cid}/satellite").json()
    assert len(listed) == 1
    assert listed[0]["lat"] == 48.8584
    assert listed[0]["method"] == "screenshot"


def test_coords_are_optional_but_only_as_a_pair(client):
    token = _token(client)
    cid = client.post("/api/cases", json={"name": "NoCoords"}).json()["id"]
    r = _post(
        client, token=token, case_id=cid,
        url="https://earth.google.com/web/",
        lat=None, lon=None, zoom=None,
    )
    assert r.status_code == 200
    assert r.json()["lat"] is None
    assert r.json()["title"] == "Google Earth"  # no coords to name it by
    # half a coordinate is a bug upstream, not a fixable-later entity: the URL
    # here carries no coords to fill the gap, so a lone lat must be refused
    r = _post(client, token=token, case_id=cid,
              url="https://earth.google.com/web/", lon=None, zoom=None)
    assert r.status_code == 422


def test_the_url_alone_is_enough_metadata(client):
    """The thin-extension contract: a client that sends nothing but the image
    and the URL still gets coordinates, zoom, title, provider and imagery date
    — every format rule lives server-side (engine/mapsites.py), where an app
    update fixes it without touching installed extensions."""
    token = _token(client)
    cid = client.post("/api/cases", json={"name": "UrlOnly"}).json()["id"]
    body = _post(
        client, token=token, case_id=cid,
        url="https://www.google.com/maps/place/Tour+Eiffel/@48.8583701,2.2944813,17z/data=!3m1",
        lat=None, lon=None, zoom=None,
    ).json()
    assert body["lat"] == 48.8583701
    assert body["lon"] == 2.2944813
    assert body["zoom"] == 17
    assert body["title"] == "Tour Eiffel"
    assert body["provider_label"] == "Google Maps"
    # explicit fields are the popup's corrections and win over the URL
    fixed = _post(
        client, token=token, case_id=cid,
        url="https://www.google.com/maps/@48.8584,2.2945,17z",
        lat="48.9", lon="2.4", title="Corrected spot",
    ).json()
    assert (fixed["lat"], fixed["lon"], fixed["title"]) == (48.9, 2.4, "Corrected spot")


def test_non_map_urls_are_refused(client):
    """Maps only (legal rails) — enforced at the endpoint, not just the popup."""
    token = _token(client)
    for url in ("https://twitter.com/somebody/status/1", "https://maps.example.org/@1,2,3z"):
        assert _post(client, token=token, url=url, lat=None, lon=None, zoom=None
                     ).status_code == 422


def test_empty_case_files_into_a_fresh_scratch_session(client):
    token = _token(client)
    body = _post(client, token=token).json()
    cases = client.get("/api/cases").json()
    match = [c for c in cases if c["id"] == body["case_id"]]
    assert match and match[0]["scratch"] is True


def test_capture_carries_provider_label_source_link_and_imagery_date(client):
    """An ingested screenshot must read like any other capture in the panels:
    provider chip filled, the source page one click away, and the imagery
    acquisition date shown when the URL carried one — all derived from the URL
    server-side, the extension sends none of it."""
    token = _token(client)
    cid = client.post("/api/cases", json={"name": "Rich"}).json()["id"]
    body = _post(
        client, token=token, case_id=cid,
        url="https://browser.dataspace.copernicus.eu/?zoom=12&lat=45.19&lng=11.77"
            "&fromTime=2024-07-01T00%3A00%3A00.000Z&toTime=2024-07-01T23%3A59%3A59.999Z",
        lat=None, lon=None, zoom=None,
    ).json()
    assert body["provider"] == "copernicus-browser"
    assert body["provider_label"] == "Copernicus Browser"
    assert body["imagery_date"] == "2024-07-01"
    listed = client.get(f"/api/cases/{cid}/satellite").json()
    assert listed[0]["provider_label"] == "Copernicus Browser"
    assert listed[0]["imagery_date"] == "2024-07-01"
    assert listed[0]["source_url"].startswith("https://browser.dataspace.copernicus.eu/")


def test_malformed_url_and_unknown_case_are_refused(client):
    token = _token(client)
    assert _post(client, token=token, url="not a url").status_code == 422
    assert _post(client, token=token, case_id="nope").status_code == 404


def test_oversized_payload_is_rejected(client, monkeypatch):
    from azimut.api import ingest

    monkeypatch.setattr(ingest, "MAX_IMAGE_BYTES", 100)  # a tiny PNG still beats 100 bytes
    assert _post(client, token=_token(client)).status_code == 413


def test_cors_opens_exactly_extension_origins_on_exactly_ingest_routes(client):
    ext = {"Origin": "chrome-extension://abcdefghijklmnop"}
    web = {"Origin": "https://evil.example"}
    # preflight from an extension: allowed, echoing the origin
    r = client.options("/api/ingest/screenshot", headers=ext)
    assert r.status_code == 204
    assert r.headers["access-control-allow-origin"] == ext["Origin"]
    assert "X-Azimut-Token" in r.headers["access-control-allow-headers"]
    # a real (401) response still carries the CORS header so the extension can
    # read the verdict instead of a mute network error
    r = client.get("/api/ingest/ping", headers=ext)
    assert r.status_code == 401
    assert r.headers["access-control-allow-origin"] == ext["Origin"]
    # a web page origin gets nothing, token or not — extensions only
    r = client.get("/api/ingest/ping", headers={**web, "X-Azimut-Token": _token(client)})
    assert "access-control-allow-origin" not in r.headers
    # extension origin outside /api/ingest/ gets nothing — the rest of the API
    # keeps the browser's same-origin default
    r = client.get("/api/health", headers=ext)
    assert "access-control-allow-origin" not in r.headers


def _bookmark(client, token=None, **overrides):
    data = {"url": "https://example.com/leak", "title": "A page"}
    data.update(overrides)
    data = {k: v for k, v in data.items() if v is not None}
    headers = {"X-Azimut-Token": token} if token else {}
    return client.post("/api/ingest/bookmark", data=data, headers=headers)


def test_bookmark_needs_the_token(client):
    _token(client)  # minted, but the request carries none
    assert _bookmark(client).status_code == 401
    assert _bookmark(client, token="wrong").status_code == 401


def test_bookmark_files_a_link_entity_without_a_screenshot(client):
    token = _token(client)
    cid = client.post("/api/cases", json={"name": "Links"}).json()["id"]
    r = _bookmark(client, token=token, case_id=cid, title="Leak site")
    assert r.status_code == 200
    body = r.json()
    assert body["case_id"] == cid and body["title"] == "Leak site"
    ents = graph_read.entities(cid)
    bm = [e for e in ents if e["type"] == "bookmark"]
    assert len(bm) == 1
    assert bm[0]["label"] == "Leak site"
    assert bm[0]["attrs"]["url"] == "https://example.com/leak"
    assert bm[0]["attrs"]["site"] == "example.com"
    # no image entity was created — a bookmark is a pointer, not a copy
    assert client.get(f"/api/cases/{cid}/media").json() == []


def test_bookmark_falls_back_to_the_host_when_untitled(client):
    token = _token(client)
    cid = client.post("/api/cases", json={"name": "Untitled"}).json()["id"]
    body = _bookmark(client, token=token, case_id=cid, title="").json()
    assert body["title"] == "example.com"


def test_bookmark_refuses_non_http_urls(client):
    token = _token(client)
    for bad in ("javascript:alert(1)", "file:///etc/passwd", "not a url"):
        assert _bookmark(client, token=token, url=bad).status_code == 422


def test_bookmark_empty_case_files_into_a_scratch_session(client):
    token = _token(client)
    body = _bookmark(client, token=token).json()
    cases = client.get("/api/cases").json()
    match = [c for c in cases if c["id"] == body["case_id"]]
    assert match and match[0]["scratch"] is True


def test_extension_zip_serves_the_packaged_runtime_files(client):
    import zipfile as zf

    r = client.get("/api/ingest/extension.zip")
    if r.status_code == 404:  # build without the extension bundled
        return
    assert r.headers["content-type"] == "application/zip"
    names = zf.ZipFile(io.BytesIO(r.content)).namelist()
    assert "manifest.json" in names
    # the dev harness must not reach an installed browser
    assert not [n for n in names if "node_modules" in n or n.endswith(".test.js")]
    assert "package.json" not in names
