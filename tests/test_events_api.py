"""The SSE nudge channel (api/events.py) and its one producer so far, ingest.

Events are advisory ("case X gained a capture") — the contract that matters is
that an ingest reliably nudges listeners with enough to know whether to
refresh, and that a saturated listener degrades to a missed nudge, never an
error inside the request that produced it.
"""

import asyncio
import io
import json

from PIL import Image

from azimut.api import events


def _png_bytes():
    buf = io.BytesIO()
    Image.new("RGB", (64, 64), (30, 90, 30)).save(buf, format="PNG")
    return buf.getvalue()


def test_publish_reaches_every_subscriber_and_unsubscribe_stops_it():
    async def scenario():
        a, b = events.subscribe(), events.subscribe()
        events.publish({"type": "capture", "case_id": "x"})
        assert (await a.get())["case_id"] == "x"
        assert (await b.get())["case_id"] == "x"
        events.unsubscribe(a)
        events.publish({"type": "capture", "case_id": "y"})
        assert (await b.get())["case_id"] == "y"
        assert a.empty()  # unsubscribed — no longer receives
        events.unsubscribe(b)

    asyncio.run(scenario())


def test_a_full_queue_drops_the_nudge_instead_of_failing_the_producer():
    async def scenario():
        q = events.subscribe()
        try:
            for i in range(events._QUEUE_SIZE + 10):  # overflow must not raise
                events.publish({"n": i})
            assert q.qsize() == events._QUEUE_SIZE
        finally:
            events.unsubscribe(q)

    asyncio.run(scenario())


def test_ingest_publishes_a_capture_nudge(client):
    token = client.post("/api/settings/ingest-token").json()["ingest_token"]
    cid = client.post("/api/cases", json={"name": "Live"}).json()["id"]
    q = events.subscribe()
    try:
        r = client.post(
            "/api/ingest/screenshot",
            files={"image": ("shot.png", _png_bytes(), "image/png")},
            data={"url": "https://www.openstreetmap.org/#map=17/48.85/2.29",
                  "case_id": cid,
                  "lat": "48.85", "lon": "2.29", "title": "Test spot"},
            headers={"X-Azimut-Token": token},
        )
        assert r.status_code == 200
        event = q.get_nowait()  # the nudge is emitted inside the request
        assert event["type"] == "capture"
        assert event["case_id"] == cid
        assert event["title"] == "Test spot"
        assert event["site"] == "openstreetmap"
        assert event["path"] == r.json()["path"]
    finally:
        events.unsubscribe(q)


def test_sse_stream_frames_events_and_ends_on_disconnect(monkeypatch):
    # The generator is tested directly: TestClient deadlocks on infinite
    # streams (the disconnect never reaches a generator the response task is
    # itself waiting on), and what matters is ours anyway — framing, the
    # settle/keepalive comments, and that a disconnect unsubscribes the queue.
    monkeypatch.setattr(events, "_PING_SECONDS", 0.01)

    async def scenario():
        q = events.subscribe()
        polls = 0

        async def is_disconnected():
            nonlocal polls
            polls += 1
            return polls > 3  # stay connected long enough to see a ping

        events.publish({"type": "capture", "case_id": "c1"})
        chunks = [chunk async for chunk in events.sse_stream(q, is_disconnected)]
        assert chunks[0] == ": connected\n\n"
        assert 'data: {"type": "capture", "case_id": "c1"}\n\n' in chunks
        assert ": ping\n\n" in chunks  # keepalive fired once the queue drained
        # the disconnect cleaned up: no lingering subscriber
        events.publish({"type": "capture", "case_id": "c2"})
        assert q.empty()

    asyncio.run(scenario())


def test_events_route_is_registered(client):
    # resolves through FastAPI's (lazily included) routers — a plain GET would
    # hang the TestClient on the infinite stream, so prove registration by name
    assert client.app.url_path_for("events") == "/api/events"


def test_event_payload_is_json_on_the_wire():
    # what the frontend JSON.parses — one data: line per event
    line = f"data: {json.dumps({'type': 'capture', 'case_id': 'c1'})}\n\n"
    assert json.loads(line[len('data: '):].strip()) == {"type": "capture", "case_id": "c1"}


# --- the second channel: the extension's panels ---------------------------------
#
# A panel drawn over another map works the same case from the other side, and it
# cannot read the app's own channel: a content script's fetch carries the map
# site's origin, which the local guard refuses. So the same bus is offered on the
# token-gated ingest island, read by the extension's background worker.


def test_the_extension_channel_needs_the_pairing_token(client):
    assert client.get("/api/ingest/events").status_code == 401


def test_both_channels_are_registered(client):
    # A plain GET would hang the TestClient on a stream that never ends, so
    # registration is proved by name — the framing itself is tested above, on the
    # generator both routes share.
    assert client.app.url_path_for("events") == "/api/events"
    assert client.app.url_path_for("ingest_events") == "/api/ingest/events"


def _token(client):
    return client.post("/api/settings/ingest-token").json()["ingest_token"]


def _rect_grid(statuses=None, title=None):
    return {
        "title": title,
        "spec": {
            "azimut_grid": 1,
            "cell_m": 500,
            "anchor": {"lat": 48.0, "lon": 2.0},
            "lat_step": 0.0045,
            "lon_step": 0.0067,
            "aoi": {
                "type": "rect",
                "bounds": {"south": 48.0, "west": 2.0, "north": 48.02, "east": 2.02},
            },
            "statuses": statuses or {},
        },
    }


def _drain(q):
    out = []
    while not q.empty():
        out.append(q.get_nowait())
    return out


# --- what a sweep worked from two places says out loud --------------------------


def test_writing_a_grid_nudges_with_the_revision_it_wrote(client):
    cid = client.post("/api/cases", json={"name": "Sweep"}).json()["id"]
    q = events.subscribe()
    try:
        saved = client.put(
            f"/api/cases/{cid}/search-grids/north", json=_rect_grid(title="North")
        ).json()
        event = q.get_nowait()
        assert event["type"] == "grid"
        assert event["case_id"] == cid
        assert event["name"] == "north"
        assert event["title"] == "North"
        # the revision is what lets the surface that wrote it stay put, and every
        # other one know the nudge is news
        assert event["revision"] == saved["revision"]
    finally:
        events.unsubscribe(q)


def test_marking_cells_nudges_from_either_road_to_the_file(client):
    token = _token(client)
    cid = client.post("/api/cases", json={"name": "Sweep"}).json()["id"]
    client.put(f"/api/cases/{cid}/search-grids/north", json=_rect_grid())
    q = events.subscribe()
    try:
        _drain(q)
        # the app's own half
        first = client.post(
            f"/api/cases/{cid}/search-grids/north/marks", json={"marks": {"0:0": "cleared"}}
        ).json()
        app_event = q.get_nowait()
        # the extension's, over another map
        second = client.post(
            "/api/ingest/grid/marks",
            json={"case_id": cid, "name": "north", "marks": {"1:1": "flagged"}},
            headers={"X-Azimut-Token": token},
        ).json()
        ext_event = q.get_nowait()
    finally:
        events.unsubscribe(q)

    for event, answer in ((app_event, first), (ext_event, second)):
        assert event["type"] == "grid-marks"
        assert event["case_id"] == cid
        assert event["name"] == "north"
        assert event["revision"] == answer["revision"]
    # one file, one counter: the second mark is behind the first, never beside it
    assert second["revision"] > first["revision"]
    assert client.get(f"/api/cases/{cid}/search-grids/north").json()["statuses"] == {
        "0:0": "cleared",
        "1:1": "flagged",
    }


def test_the_app_marks_cells_without_writing_the_sweep_around_them(client):
    # The point of the route: two surfaces sweeping different cells of one grid
    # both land. A whole-spec save from either would carry the copy it loaded.
    token = _token(client)
    cid = client.post("/api/cases", json={"name": "Sweep"}).json()["id"]
    client.put(f"/api/cases/{cid}/search-grids/north", json=_rect_grid())
    client.post(
        "/api/ingest/grid/marks",
        json={"case_id": cid, "name": "north", "marks": {"0:0": "cleared"}},
        headers={"X-Azimut-Token": token},
    )
    client.post(
        f"/api/cases/{cid}/search-grids/north/marks", json={"marks": {"1:1": "flagged"}}
    )
    assert client.get(f"/api/cases/{cid}/search-grids/north").json()["statuses"] == {
        "0:0": "cleared",
        "1:1": "flagged",
    }


def test_the_app_can_clear_a_cell_back_to_unchecked(client):
    cid = client.post("/api/cases", json={"name": "Sweep"}).json()["id"]
    client.put(f"/api/cases/{cid}/search-grids/north", json=_rect_grid({"0:0": "cleared"}))
    client.post(f"/api/cases/{cid}/search-grids/north/marks", json={"marks": {"0:0": None}})
    assert client.get(f"/api/cases/{cid}/search-grids/north").json()["statuses"] == {}


def test_marking_a_grid_the_case_does_not_have(client):
    cid = client.post("/api/cases", json={"name": "Sweep"}).json()["id"]
    r = client.post(f"/api/cases/{cid}/search-grids/nope/marks", json={"marks": {"0:0": "cleared"}})
    assert r.status_code == 404


def test_discarding_a_grid_nudges_once_and_only_when_it_existed(client):
    cid = client.post("/api/cases", json={"name": "Sweep"}).json()["id"]
    client.put(f"/api/cases/{cid}/search-grids/north", json=_rect_grid())
    q = events.subscribe()
    try:
        _drain(q)
        client.delete(f"/api/cases/{cid}/search-grids/north")
        event = q.get_nowait()
        assert event == {"type": "grid-removed", "case_id": cid, "name": "north"}
        # gone already: nothing changed, so nothing is said
        client.delete(f"/api/cases/{cid}/search-grids/north")
        assert q.empty()
    finally:
        events.unsubscribe(q)


# --- and what the case's points say ---------------------------------------------


def test_saving_a_point_in_the_app_nudges_the_panels(client):
    cid = client.post("/api/cases", json={"name": "Points"}).json()["id"]
    q = events.subscribe()
    try:
        client.post(
            f"/api/cases/{cid}/satellite/place",
            json={"lat": 48.85, "lon": 2.29, "zoom": 17, "bearing": 0},
        )
        assert q.get_nowait() == {"type": "saved", "case_id": cid}
    finally:
        events.unsubscribe(q)


def test_deleting_a_point_nudges_the_panels(client):
    cid = client.post("/api/cases", json={"name": "Points"}).json()["id"]
    entity = client.post(
        f"/api/cases/{cid}/satellite/place",
        json={"lat": 48.85, "lon": 2.29, "zoom": 17, "bearing": 0},
    ).json()
    q = events.subscribe()
    try:
        _drain(q)
        client.delete(f"/api/cases/{cid}/entities/{entity['id']}")
        assert q.get_nowait() == {"type": "saved", "case_id": cid}
    finally:
        events.unsubscribe(q)


def test_deleting_something_no_map_draws_says_nothing(client):
    # the nudge is for the surfaces drawing a case on a map; a note is not one
    cid = client.post("/api/cases", json={"name": "Points"}).json()["id"]
    note = client.post(
        f"/api/cases/{cid}/entities", json={"type": "note", "label": "A thought"}
    ).json()
    q = events.subscribe()
    try:
        _drain(q)
        client.delete(f"/api/cases/{cid}/entities/{note['id']}")
        assert q.empty()
    finally:
        events.unsubscribe(q)
