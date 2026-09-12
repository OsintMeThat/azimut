"""The map tools' half of the ingest API (api/ingest.py).

The tools in `extension/mapoverlay.js` draw the app's own work over someone
else's map, which means the extension now *reads* a case as well as filing into
one. Three walls are what make that acceptable, and each test here holds one of
them up:

* the pairing token guards every route, the new ones included;
* what comes back is trimmed to what a pin or a lattice needs, not an app
  payload forwarded whole;
* a sweep worked from the app and from a map tab at once converges, because the
  extension sends the cells it touched and never a copy of the grid.
"""

import io

import pytest
from PIL import Image


def _token(client):
    return client.post("/api/settings/ingest-token").json()["ingest_token"]


def _headers(client):
    return {"X-Azimut-Token": _token(client)}


def _case(client, name="Sweep"):
    return client.post("/api/cases", json={"name": name}).json()["id"]


def _spec(south=48.85, west=2.29, north=48.87, east=2.31, statuses=None):
    return {
        "azimut_grid": 1,
        "cell_m": 500,
        "anchor": {"lat": south, "lon": west},
        "lat_step": 0.0045,
        "lon_step": 0.0067,
        "aoi": {"type": "rect", "bounds": {
            "south": south, "west": west, "north": north, "east": east}},
        "statuses": statuses or {},
    }


MAP_ROUTES = [
    ("get", "/api/ingest/saved", {"case_id": "x"}),
    ("get", "/api/ingest/media", {"case_id": "x"}),
    ("get", "/api/ingest/sky", {"lat": 48.8, "lon": 2.3}),
    ("get", "/api/ingest/grids", {"case_id": "x"}),
    ("get", "/api/ingest/grid", {"case_id": "x", "name": "a"}),
]


@pytest.mark.parametrize("method,path,params", MAP_ROUTES)
def test_reading_a_case_needs_the_token(client, method, path, params):
    # the routes read case contents, so an unpaired caller must not reach them
    # even to find out whether a case exists
    assert getattr(client, method)(path, params=params).status_code == 401


def test_writing_a_grid_needs_the_token(client):
    body = {"case_id": "x", "title": "Sweep", "spec": _spec()}
    assert client.post("/api/ingest/grid", json=body).status_code == 401
    marks = {"case_id": "x", "name": "a", "marks": {"0:0": "cleared"}}
    assert client.post("/api/ingest/grid/marks", json=marks).status_code == 401


def test_saved_points_are_trimmed_to_what_a_pin_draws(client):
    headers = _headers(client)
    cid = _case(client, "Pins")
    client.post(
        "/api/ingest/place",
        headers=headers,
        data={
            "url": "https://www.google.com/maps/@48.8584,2.2945,17z",
            "case_id": cid,
            "title": "Gate",
        },
    )
    rows = client.get("/api/ingest/saved", params={"case_id": cid}, headers=headers).json()
    assert len(rows) == 1
    # the app's own index carries thumbnails, folders, continents and link
    # tallies; none of that crosses into a browser extension
    assert set(rows[0]) == {"id", "kind", "title", "lat", "lon"}
    assert rows[0]["title"] == "Gate"
    assert rows[0]["lat"] == pytest.approx(48.8584)


def test_saved_points_drop_rows_with_no_position(client):
    headers = _headers(client)
    cid = _case(client, "Mixed")
    client.post(
        "/api/ingest/bookmark",
        headers=headers,
        data={"url": "https://example.com/article", "case_id": cid, "title": "Article"},
    )
    # a bookmark has no coordinates, so there is nowhere to draw it
    assert client.get("/api/ingest/saved", params={"case_id": cid}, headers=headers).json() == []


def _upload(client, cid, name, colour=(30, 90, 30)):
    buf = io.BytesIO()
    Image.new("RGB", (48, 32), colour).save(buf, format="PNG")
    return client.post(
        f"/api/cases/{cid}/media/upload",
        files={"file": (name, io.BytesIO(buf.getvalue()), "image/png")},
    ).json()["item"]


def _upload_video(client, cid, name="walk.mp4"):
    body = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 64
    return client.post(
        f"/api/cases/{cid}/media/upload",
        files={"file": (name, io.BytesIO(body), "video/mp4")},
    ).json()["item"]


def test_reference_media_is_trimmed_to_what_the_picker_draws(client):
    headers = _headers(client)
    cid = _case(client, "Refs")
    _upload(client, cid, "roof.png")

    answer = client.get("/api/ingest/media", params={"case_id": cid}, headers=headers).json()
    assert answer["total"] == 1
    # a thumbnail path, a name and which of the two kinds it is, is the whole of
    # what a picker tile is; the app's own index carries metadata dumps, GPS,
    # enrichment state and folder counts, none of which an extension can use
    assert set(answer["items"][0]) == {"path", "filename", "title", "kind", "thumbnail"}
    assert answer["items"][0]["filename"] == "roof.png"


def test_reference_media_offers_both_kinds_and_filters_to_one(client):
    """Images and videos both: the frame to place is as often in a video, and the
    window plays it. Anything else in a case has nothing to show beside a map."""
    headers = _headers(client)
    cid = _case(client, "Mixed")
    _upload(client, cid, "roof.png")
    _upload_video(client, cid)
    client.post(
        f"/api/cases/{cid}/media/upload",
        files={"file": ("notes.txt", io.BytesIO(b"nothing to look at"), "text/plain")},
    )

    both = client.get("/api/ingest/media", params={"case_id": cid}, headers=headers).json()
    assert {item["filename"] for item in both["items"]} == {"roof.png", "walk.mp4"}
    assert both["total"] == 2  # the text file is not a reference

    for kind, filename in (("image", "roof.png"), ("video", "walk.mp4")):
        one = client.get(
            "/api/ingest/media", params={"case_id": cid, "kind": kind}, headers=headers
        ).json()
        assert [item["filename"] for item in one["items"]] == [filename]
        assert one["items"][0]["kind"] == kind
        assert one["total"] == 1


def test_reference_media_is_ordered_the_way_the_picker_asked(client):
    """The merge of the two kinds keeps the order the store was asked for, or the
    picker's sort would only ever apply within one kind."""
    headers = _headers(client)
    cid = _case(client, "Order")
    _upload(client, cid, "beta.png")
    _upload_video(client, cid, "alpha.mp4")

    def names(**params):
        answer = client.get(
            "/api/ingest/media", params={"case_id": cid, **params}, headers=headers
        ).json()
        return [item["filename"] for item in answer["items"]]

    # a name sort that only ordered within one kind would leave the video after
    # the image, which is the whole failure mode of merging two queries
    assert names(sort="name") == ["alpha.mp4", "beta.png"]
    # both were filed in the same second, so what is asserted is that one order
    # is the other turned round — not which of them the clock happened to favour
    assert names(sort="oldest") == list(reversed(names(sort="newest")))


def test_reference_media_is_searched_and_bounded(client):
    headers = _headers(client)
    cid = _case(client, "Big")
    for index in range(4):
        _upload(client, cid, f"roof-{index}.png", colour=(index * 20, 90, 30))
    _upload(client, cid, "courtyard.png")

    narrowed = client.get(
        "/api/ingest/media", params={"case_id": cid, "q": "courtyard"}, headers=headers
    ).json()
    assert [item["filename"] for item in narrowed["items"]] == ["courtyard.png"]

    # a case of two thousand files must not cross the extension boundary whole,
    # and the picker says how much of it it is showing
    page = client.get(
        "/api/ingest/media", params={"case_id": cid, "limit": 2}, headers=headers
    ).json()
    assert len(page["items"]) == 2
    assert page["total"] == 5


def test_sky_answers_the_panel_for_a_point(client):
    # The panel has to work on a map tab with no connection, and that guarantee
    # is held one layer down, where it can be held honestly:
    # `test_sky.py::test_sky_does_not_touch_the_network` makes every socket
    # explode and calls the computation directly.
    #
    # It cannot be re-proved through this route, because the client that would
    # ask is itself a loop that opens sockets to talk to its own server thread:
    # taking `socket.socket` away does not stop the route reaching out, it stops
    # the request arriving, and the call never returns. That deadlock has no
    # timeout under it, so it costs the whole Windows shard — twice, before the
    # traceback said so. What is left here is what only this layer can answer:
    # the route exists, takes a point, and hands the panel the shape it draws.
    day = client.get(
        "/api/ingest/sky", params={"lat": 48.8584, "lon": 2.2945}, headers=_headers(client)
    ).json()
    assert day["curve"]["clock"]
    assert len(day["curve"]["sun_altitude"]) == len(day["curve"]["clock"])
    assert day["sun"]["rise"]["local"]


def test_sky_reads_the_day_it_was_asked_for(client):
    # the panel's date field: a sweep is often about a day that is not today,
    # and the shadows on an image are only evidence against the right one
    day = client.get(
        "/api/ingest/sky",
        params={"lat": 48.8584, "lon": 2.2945, "date": "2026-01-15"},
        headers=_headers(client),
    ).json()
    assert day["date"] == "2026-01-15"
    # ...and the point's own zone decides which day that is, not the server's
    assert day["zone"]


def test_sky_refuses_a_day_it_cannot_read(client):
    r = client.get(
        "/api/ingest/sky",
        params={"lat": 48.8584, "lon": 2.2945, "date": "not-a-day"},
        headers=_headers(client),
    )
    assert r.status_code in (400, 422)


def test_a_grid_drawn_over_another_map_opens_in_the_app(client):
    headers = _headers(client)
    cid = _case(client)
    saved = client.post(
        "/api/ingest/grid",
        headers=headers,
        json={"case_id": cid, "title": "North sweep", "spec": _spec()},
    ).json()
    # the title is the visible filename, as everywhere else in the app: case
    # and spaces survive, only what Windows forbids is replaced (layout.slugify)
    assert saved["name"] == "North sweep"

    # the app reads the same file through its own route, unchanged
    loaded = client.get(f"/api/cases/{cid}/search-grids/North sweep").json()
    assert loaded["azimut_grid"] == 1
    assert loaded["aoi"]["bounds"]["south"] == pytest.approx(48.85)

    listed = client.get("/api/ingest/grids", params={"case_id": cid}, headers=headers).json()
    assert [g["name"] for g in listed] == ["North sweep"]
    fetched = client.get(
        "/api/ingest/grid", params={"case_id": cid, "name": "North sweep"}, headers=headers
    ).json()
    assert fetched["cell_m"] == 500


def test_two_sweeps_of_one_grid_both_land(client):
    """The property the whole patch exists for.

    The app marks a cell; the extension, holding a copy loaded before that,
    marks a different one. Both marks survive — which a save carrying a whole
    spec could not manage, since the extension's copy still says the app's cell
    is unchecked.
    """
    headers = _headers(client)
    cid = _case(client)
    client.post(
        "/api/ingest/grid",
        headers=headers,
        json={"case_id": cid, "title": "Sweep", "spec": _spec()},
    )
    stale = client.get(
        "/api/ingest/grid", params={"case_id": cid, "name": "Sweep"}, headers=headers
    ).json()
    assert stale["statuses"] == {}

    # the app, in its own window
    client.put(
        f"/api/cases/{cid}/search-grids/Sweep",
        json={"spec": {**stale, "statuses": {"0:0": "cleared"}}},
    )
    # the extension, from the copy it loaded before that
    client.post(
        "/api/ingest/grid/marks",
        headers=headers,
        json={"case_id": cid, "name": "Sweep", "marks": {"1:1": "flagged"}},
    )

    after = client.get(f"/api/cases/{cid}/search-grids/Sweep").json()
    assert after["statuses"] == {"0:0": "cleared", "1:1": "flagged"}


def test_a_whole_spec_save_that_is_behind_is_refused(client):
    """The other half of the same story.

    The extension patches, so it cannot clobber. The app saves whole specs, so
    it can — and the only thing standing between it and the extension's marks is
    the copy it claims to be replacing. Claiming an older one is refused rather
    than written.
    """
    headers = _headers(client)
    cid = _case(client)
    client.post(
        "/api/ingest/grid",
        headers=headers,
        json={"case_id": cid, "title": "Sweep", "spec": _spec()},
    )
    opened = client.get(f"/api/cases/{cid}/search-grids/Sweep").json()

    # the extension marks a cell from a map tab
    client.post(
        "/api/ingest/grid/marks",
        headers=headers,
        json={"case_id": cid, "name": "Sweep", "marks": {"1:1": "flagged"}},
    )

    stale = client.put(
        f"/api/cases/{cid}/search-grids/Sweep",
        json={"spec": opened, "base_revision": opened["revision"]},
    )
    assert stale.status_code == 409
    # and the mark it would have erased is still there
    assert client.get(f"/api/cases/{cid}/search-grids/Sweep").json()["statuses"] == {
        "1:1": "flagged"
    }


def test_a_save_that_claims_the_current_copy_goes_through(client):
    headers = _headers(client)
    cid = _case(client)
    client.post(
        "/api/ingest/grid",
        headers=headers,
        json={"case_id": cid, "title": "Sweep", "spec": _spec()},
    )
    current = client.get(f"/api/cases/{cid}/search-grids/Sweep").json()
    saved = client.put(
        f"/api/cases/{cid}/search-grids/Sweep",
        json={
            "spec": {**current, "statuses": {"0:0": "cleared"}},
            "base_revision": current["revision"],
        },
    )
    assert saved.status_code == 200


def test_a_mark_can_be_taken_back(client):
    headers = _headers(client)
    cid = _case(client)
    client.post(
        "/api/ingest/grid",
        headers=headers,
        json={"case_id": cid, "title": "Sweep", "spec": _spec(statuses={"0:0": "cleared"})},
    )
    answer = client.post(
        "/api/ingest/grid/marks",
        headers=headers,
        json={"case_id": cid, "name": "Sweep", "marks": {"0:0": None, "2:3": "cleared"}},
    ).json()
    assert answer["cleared"] == 1
    assert client.get(f"/api/cases/{cid}/search-grids/Sweep").json()["statuses"] == {
        "2:3": "cleared"
    }


def test_an_invented_mark_is_refused(client):
    headers = _headers(client)
    cid = _case(client)
    client.post(
        "/api/ingest/grid",
        headers=headers,
        json={"case_id": cid, "title": "Sweep", "spec": _spec()},
    )
    r = client.post(
        "/api/ingest/grid/marks",
        headers=headers,
        json={"case_id": cid, "name": "Sweep", "marks": {"0:0": "burned"}},
    )
    assert r.status_code == 400


def test_marking_a_grid_that_is_not_there(client):
    r = client.post(
        "/api/ingest/grid/marks",
        headers=_headers(client),
        json={"case_id": _case(client), "name": "nothing", "marks": {"0:0": "cleared"}},
    )
    assert r.status_code == 404


def test_ping_carries_the_units_the_app_states(client):
    headers = _headers(client)
    assert client.get("/api/ingest/ping", headers=headers).json()["units"] == "metric"
    client.put("/api/settings/prefs", json={"units": "imperial"})
    # the panel measures over another map; stating feet where the app states
    # metres would be one tool answering a question two ways
    assert client.get("/api/ingest/ping", headers=headers).json()["units"] == "imperial"
