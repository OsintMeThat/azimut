"""Server-sent events: the app hears about things that happen behind its back.

The capture extension files screenshots through /api/ingest while the app tab
just sits there — without a push channel the user would have to reload to see
their own capture. This is that channel: an in-process pub/sub (no broker, no
persistence — spec §4) streamed over SSE. Same-origin only, so it stays inside
the local-first rule: the browser talks to its own backend, nothing else.

Events are advisory nudges ("case X gained a capture"), never the data itself:
a consumer reacts by re-fetching through the normal API, so a missed event
costs a refresh, not correctness.

There are now three kinds of listener — the app's own tab, a second app tab, and
every map panel the extension has open over someone else's map — and one file
each of them writes to. So the vocabulary is fixed here rather than left to the
producers. Every event carries ``case_id``; the rest is what a consumer needs to
decide whether the nudge is about the thing it is holding:

``capture``       the extension filed a screenshot (``path``, ``title``, ``site``)
``bookmark``      the extension filed a page (``entity_id``, ``title``, ``url``)
``place``         the extension filed a point (``entity_id``, ``title``, ``site``)
``saved``         the app's own saved work changed: a point, a capture, a deletion
``grid``          a search grid was created or replaced (``name``, ``title``, ``revision``)
``grid-marks``    cells were marked on a grid (``name``, ``revision``)
``grid-removed``  a grid was discarded (``name``)

The first three are the ones the analyst cannot see happening, so the app says so
out loud when they arrive; the rest are quiet and only refresh what they name. The
grid pair carries the file's ``revision`` because a surface that has just written
it hears its own nudge back, and a revision it already holds is how it tells that
apart from someone else's mark.

Two channels, one bus: the app reads ``/api/events`` same-origin, and the
extension reads ``/api/ingest/events`` with the pairing token — a content script's
own fetch carries the *map site's* origin, which the local guard refuses, so the
panel never opens this itself. Its background worker holds one stream for every
panel (``extension/background.js``).
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

router = APIRouter(prefix="/api", tags=["events"])

# One queue per connected listener. Bounded so one stuck consumer can't grow
# memory — events are droppable nudges (see module docstring), so a full queue
# just loses a refresh hint, never data.
_subscribers: set[asyncio.Queue] = set()
_QUEUE_SIZE = 64


def subscribe() -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=_QUEUE_SIZE)
    _subscribers.add(q)
    return q


def unsubscribe(q: asyncio.Queue) -> None:
    _subscribers.discard(q)


def publish(event: dict[str, Any]) -> None:
    """Fan an event out to every listener. Non-blocking by design: called from
    request handlers that must never wait on a slow consumer."""
    for q in list(_subscribers):
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            pass  # a saturated listener misses a nudge, nothing more


# How long the stream waits for an event before emitting a keepalive comment.
# The ping doubles as the disconnect probe: a closed client is only noticed at
# a write, so this bounds how long a dead connection can linger. Tests shrink it.
_PING_SECONDS = 15.0


async def sse_stream(q: asyncio.Queue, is_disconnected):
    """The SSE generator, separated from the route so it is testable without
    a live transport (TestClient deadlocks on infinite streams). One `data:`
    line per event; `: ping` comments double as keepalive and as the moment a
    dead connection gets noticed (a closed client only fails at a write)."""
    try:
        # an immediate comment line lets EventSource settle the connection
        yield ": connected\n\n"
        while not await is_disconnected():
            try:
                event = await asyncio.wait_for(q.get(), timeout=_PING_SECONDS)
            except asyncio.TimeoutError:
                yield ": ping\n\n"
                continue
            yield f"data: {json.dumps(event)}\n\n"
    finally:
        unsubscribe(q)


@router.get("/events")
async def events(request: Request) -> StreamingResponse:
    return StreamingResponse(
        sse_stream(subscribe(), request.is_disconnected),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
