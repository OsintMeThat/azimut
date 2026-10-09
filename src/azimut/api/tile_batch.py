"""Many map tiles in one answer, each written the moment it is ready.

A browser keeps six connections to one host, and every tile of the live map
comes through the app (api/satellite.py, api/terrain.py). Tilted toward the
horizon, a view asks for a hundred tiles at once, and each one waited for a
free connection before the app even heard of it. So the tilted map asks for
up to `BATCH_MAX` tiles in one request (lib/map/tileBatch.js): the app fetches
them side by side and writes each as soon as it is done, so a slow tile holds
up none of the others.

Each tile is one frame: its place in the list asked (u16), the status its own
route would have answered (u16), the length of what follows (u32), then the
tile, or for a tile that failed the reason, as text. Little-endian.
"""

from __future__ import annotations

import logging
import re
import struct
from collections.abc import Callable, Iterator
from concurrent.futures import Future, ThreadPoolExecutor, as_completed

from fastapi import HTTPException
from fastapi.responses import StreamingResponse

log = logging.getLogger(__name__)

# Tiles one batch may ask for (lib/map/tileBatch.js `BATCH_MAX` stays under it).
BATCH_MAX = 64
# A key is at most "22/4194303/4194303": 18 characters, plus its comma.
QUERY_MAX = BATCH_MAX * 19
_KEY = re.compile(r"^\d{1,2}/\d{1,7}/\d{1,7}$")
# Bounded: the laptop this runs on has other things to do, and the map's own
# connections to the providers are pooled to about this many.
_WORKERS = 12
_pool = ThreadPoolExecutor(max_workers=_WORKERS, thread_name_prefix="tile-batch")

Tile = tuple[int, int, int]
# What one tile answers: its status, and the tile or the reason it failed.
Served = tuple[int, bytes]


def tile_keys(t: str, max_zoom: int) -> list[Tile]:
    """The `z/x/y` keys of a batch, checked at the edge."""
    keys: list[Tile] = []
    for part in t.split(","):
        if not _KEY.match(part):
            raise HTTPException(status_code=422, detail="Tiles are listed as z/x/y, comma-separated")
        z, x, y = (int(v) for v in part.split("/"))
        if z > max_zoom:
            raise HTTPException(status_code=422, detail=f"Tile zoom goes up to {max_zoom}")
        if x >= 1 << z or y >= 1 << z:
            raise HTTPException(status_code=422, detail="A tile lies outside the grid of its zoom")
        keys.append((z, x, y))
    if not keys:
        raise HTTPException(status_code=422, detail="Ask for at least one tile")
    if len(keys) > BATCH_MAX:
        raise HTTPException(status_code=422, detail=f"At most {BATCH_MAX} tiles in one request")
    return keys


def frame(index: int, status: int, body: bytes) -> bytes:
    """One tile of a batch answer."""
    return struct.pack("<HHI", index, status, len(body)) + body


def _served(one: Callable[[int, int, int], Served], key: Tile) -> Served:
    """A tile as its own route would answer it, a refusal included."""
    try:
        return one(*key)
    except HTTPException as exc:
        return exc.status_code, str(exc.detail).encode("utf-8")
    except Exception:
        log.exception("a batched tile failed: %s", key)
        return 500, b"This tile could not be read"


def frames(keys: list[Tile], one: Callable[[int, int, int], Served]) -> Iterator[bytes]:
    """Fetch every tile side by side; the frames, each one as its tile is done."""
    futures: dict[Future[Served], int] = {
        _pool.submit(_served, one, key): index for index, key in enumerate(keys)
    }
    return _written(futures)


def _written(futures: dict[Future[Served], int]) -> Iterator[bytes]:
    try:
        for done in as_completed(futures):
            status, body = done.result()
            yield frame(futures[done], status, body)
    finally:
        # the map stopped reading (it moved on): drop what has not started
        for future in futures:
            future.cancel()


def stream(keys: list[Tile], one: Callable[[int, int, int], Served]) -> StreamingResponse:
    """Fetch every tile side by side, and write each one as it is done."""
    return StreamingResponse(
        frames(keys, one),
        media_type="application/octet-stream",
        # one answer is one view's tiles; each tile is kept by the map itself
        headers={"Cache-Control": "no-store"},
    )
