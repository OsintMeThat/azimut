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
    token = client.get("/api/settings").json()["ingest_token"]
    cid = client.post("/api/cases", json={"name": "Live"}).json()["id"]
    q = events.subscribe()
    try:
        r = client.post(
            "/api/ingest/screenshot",
            files={"image": ("shot.png", _png_bytes(), "image/png")},
            data={"url": "https://www.openstreetmap.org/#map=17/48.85/2.29",
                  "site": "openstreetmap", "case_id": cid,
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
