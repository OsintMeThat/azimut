"""Tiles a tilted map is about to turn toward, fetched into the disk caches first.

Every tile of the live map comes through the app, and the browser holds six
connections to it (HTTP/1.1 to one host). A tile already on disk is served in a
few milliseconds; one that has to be asked of Esri or Mapterhorn first takes a
few hundred. Looking straight down that never shows. Tilted toward the
horizon, a quick half turn uncovers dozens of tiles at once, they queue behind
those six connections, and the ground arrives in patches.

So when a tilted view settles, the map works out which tiles a full turn would
show (its own engine answers that: frontend lib/map/warmTurn.js) and sends the
list here, where it is fetched into the disk caches many at a time. The turn
then reads it from disk.

One warm-up at a time: a newer list replaces the one still being fetched, whose
remaining tiles are dropped, because the view they were for has gone. Workers
are daemon threads, so a long list never holds the app open on exit. A failed
tile is skipped quietly: the map asks for it again when it shows it, and says
so then if it still fails.
"""

from __future__ import annotations

import logging
import queue
import threading
from collections.abc import Callable, Iterable

logger = logging.getLogger(__name__)

WORKERS = 16

Job = Callable[[], object]


class Warmer:
    """Runs the latest list of jobs, dropping whatever an older list had left."""

    def __init__(self, workers: int = WORKERS) -> None:
        self._workers = workers
        self._queue: queue.SimpleQueue[tuple[int, Job]] = queue.SimpleQueue()
        self._lock = threading.Lock()
        self._idle = threading.Condition(self._lock)
        self._generation = 0
        self._pending = 0
        self._started = False

    def replace(self, jobs: Iterable[Job]) -> int:
        """Drop what is still queued and run these instead. Returns how many."""
        listed = list(jobs)
        with self._lock:
            self._generation += 1
            generation = self._generation
            if not self._started:
                for n in range(self._workers):
                    threading.Thread(
                        target=self._work, name=f"tile-warm-{n}", daemon=True
                    ).start()
                self._started = True
            self._pending += len(listed)
        for job in listed:
            self._queue.put((generation, job))
        return len(listed)

    def wait(self, timeout: float | None = None) -> bool:
        """Block until every queued job ran or was dropped. For tests."""
        with self._idle:
            return self._idle.wait_for(lambda: self._pending == 0, timeout)

    def _work(self) -> None:
        while True:
            generation, job = self._queue.get()
            try:
                if generation == self._generation:
                    job()
            except Exception:  # an optimisation: the map asks again when it shows the tile
                logger.debug("a tile warm-up failed", exc_info=True)
            finally:
                with self._idle:
                    self._pending -= 1
                    if self._pending == 0:
                        self._idle.notify_all()
