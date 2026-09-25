"""Disk tile cache for providers whose terms allow it (docs/IMAGERY_PROVIDERS.md).

Layout: ``<workspace>/.azimut/cache/tiles/<provider_id>/<z>/<x>_<y>.<ext>`` — plain
files, rebuildable, safe to delete wholesale. Only providers with
``cacheable=True`` land here: Google is excluded by its Map Tiles API terms
(encoded as ``cacheable=False`` on the provider, enforced by the callers).
Entries expire after ``TTL_DAYS``: this is a transient performance/cost cache,
never a permanent offline imagery store.
"""

from __future__ import annotations

import os
import time
from pathlib import Path

from .. import config

TTL_DAYS = 30
# content-type ↔ file extension; anything else (HTML error pages, exotic
# formats) is simply not cached
_EXT = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
_TYPE = {ext: media for media, ext in _EXT.items()}


def _tile_dir(provider_id: str, z: int) -> Path:
    return config.tile_cache_dir() / provider_id / str(int(z))


def get(provider_id: str, z: int, x: int, y: int) -> tuple[bytes, str] | None:
    """Cached ``(content, media_type)`` if present and fresh; stale entries are
    dropped on sight. Never raises — a broken cache reads as a miss."""
    base = _tile_dir(provider_id, z)
    for ext, media_type in _TYPE.items():
        path = base / f"{int(x)}_{int(y)}.{ext}"
        try:
            if not path.is_file():
                continue
            if time.time() - path.stat().st_mtime > TTL_DAYS * 86400:
                path.unlink(missing_ok=True)
                return None
            return path.read_bytes(), media_type
        except OSError:
            return None
    return None


def put(provider_id: str, z: int, x: int, y: int, content: bytes, media_type: str) -> None:
    """Store one served tile. Never raises — the cache is an optimization."""
    ext = _EXT.get((media_type or "").split(";")[0].strip())
    if not ext or not content:
        return
    try:
        base = _tile_dir(provider_id, z)
        base.mkdir(parents=True, exist_ok=True)
        (base / f"{int(x)}_{int(y)}.{ext}").write_bytes(content)
    except OSError:
        pass


def sweep(now: float | None = None) -> int:
    """Delete every entry past `TTL_DAYS`, read again or not. Returns how many went.

    `get` drops a stale entry only when it is asked for, and a tile of a date
    nobody asks for again (most of what a Detect sweep reads) would otherwise
    stay for good, which is the permanent imagery store this cache must not
    become. Never raises: a file another process holds is left for next time.
    """
    root = config.tile_cache_dir()
    cutoff = (time.time() if now is None else now) - TTL_DAYS * 86400
    dropped = 0
    for folder, _subfolders, files in os.walk(root, topdown=False):
        for name in files:
            path = Path(folder) / name
            try:
                if path.stat().st_mtime < cutoff:
                    path.unlink()
                    dropped += 1
            except OSError:
                continue
        if Path(folder) != root:
            try:
                Path(folder).rmdir()  # refused while anything is left in it
            except OSError:
                pass
    return dropped
