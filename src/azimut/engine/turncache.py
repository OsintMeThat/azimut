"""Turns already swept, kept on disk so a search run again reads them back instead of sweeping.

A search sweeps the turn seen from each of its thousands of points (engine/finder.py), and that turn
depends only on where the eye stands and how the turn is read: the columns, how far out, where it is
cut, how finely the ground near the eye is read. Not on the trace, the marks or the case. So a search
run again over the same area (a hint changed, a line marked Sky only) reads every turn it swept the
first time back from here, and only the match is done again.

The cache sits beside the terrain's, outside every case and backup, and holds what the search reads of
a sweep: the skyline and its cuts, how far out each stands, and the silhouettes. It is bounded by size,
the turns read least recently going first (`sweep`). It is only used with the terrain the app reads
(`terrain.tile` as shipped): a turn swept off another source must not come back as this one's.
"""

from __future__ import annotations

import hashlib
import io
import os
import time
from collections.abc import Sequence
from pathlib import Path

import numpy as np

from .. import config
from . import horizon, terrain

# What the turns may take on disk; a sweep brings it back under 80% of it.
BUDGET_BYTES = 256 << 20
# Raised when what a turn holds, or how it is swept, changes: older turns are then never read.
VERSION = 1

# the terrain source the turns are swept off, as shipped
_SHIPPED_TILE = terrain.tile


def cache_dir() -> Path:
    return config.internal_dir() / "cache" / "turns"


def usable() -> bool:
    """Whether turns may be kept and read: only off the terrain the app reads."""
    return terrain.tile is _SHIPPED_TILE


def key_of(
    observer: horizon.Observer, azimuths: np.ndarray, far: float, cuts: Sequence[float], near_step: float,
    k: float = horizon.REFRACTION_K,
) -> str:
    """The name a turn is kept under: everything the sweep reads it with."""
    columns = np.ascontiguousarray(np.round(np.asarray(azimuths, dtype=np.float64), 6))
    said = (
        f"{VERSION}|{observer.lat:.6f}|{observer.lon:.6f}|{observer.mode}|{observer.height:.3f}|{float(far):.1f}|"
        f"{','.join(f'{float(c):.1f}' for c in cuts)}|{float(near_step):.3f}|{float(k):.4f}|"
    )
    digest = hashlib.sha1(said.encode())
    digest.update(columns.tobytes())
    return digest.hexdigest()


def _path(key: str) -> Path:
    return cache_dir() / key[:2] / f"{key}.npz"


def read(key: str, observer: horizon.Observer, azimuths: np.ndarray, far: float) -> horizon.Horizon | None:
    """The turn kept under `key`, or None. A turn read is marked as read now, so it is kept longest."""
    path = _path(key)
    try:
        with np.load(path) as held:
            kept = {name: held[name] for name in held.files}
        os.utime(path)
    except (OSError, ValueError, KeyError, EOFError):
        return None
    try:
        return horizon.Horizon(
            observer=observer, ground=float(kept["ground"]), altitude=float(kept["altitude"]), k=float(kept["k"]),
            far=float(far), azimuths=np.asarray(azimuths, dtype=np.float64),
            skyline=kept["skyline"].astype(np.float64), skyline_distance=kept["skyline_distance"].astype(np.float64),
            ridge_column=kept["ridge_column"].astype(np.int64), ridge_angle=kept["ridge_angle"].astype(np.float64),
            ridge_distance=kept["ridge_distance"].astype(np.float64), cuts=kept["cuts"].astype(np.float64),
            skyline_cuts=kept["skyline_cuts"].astype(np.float64),
            skyline_cuts_distance=kept["skyline_cuts_distance"].astype(np.float64),
        )
    except KeyError:
        return None


def write(key: str, swept: horizon.Horizon) -> None:
    """Keep a turn. Never raises: a turn not kept is swept again next time."""
    path = _path(key)
    buffer = io.BytesIO()
    np.savez_compressed(
        buffer, ground=np.float64(swept.ground), altitude=np.float64(swept.altitude), k=np.float64(swept.k),
        skyline=swept.skyline.astype(np.float32), skyline_distance=swept.skyline_distance.astype(np.float32),
        ridge_column=swept.ridge_column.astype(np.int32), ridge_angle=swept.ridge_angle.astype(np.float32),
        ridge_distance=swept.ridge_distance.astype(np.float32), cuts=np.asarray(swept.cuts, dtype=np.float64),
        skyline_cuts=np.asarray(swept.skyline_cuts, dtype=np.float32),
        skyline_cuts_distance=np.asarray(swept.skyline_cuts_distance, dtype=np.float32),
    )
    # written aside then moved in, so a turn another process reads is never half written
    partial = path.with_name(f"{path.stem}.{os.getpid()}.part")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        partial.write_bytes(buffer.getvalue())
        os.replace(partial, path)
    except OSError:
        try:
            partial.unlink()
        except OSError:
            pass


def swept(
    observer: horizon.Observer, *, azimuths: np.ndarray, far: float, cuts: Sequence[float], sampler: terrain.Sampler,
    workers: int, near_step: float,
) -> horizon.Horizon:
    """`horizon.sweep`'s turn for a search, read back when it was kept, else swept and kept."""
    if not usable():
        return horizon.sweep(observer, azimuths=azimuths, far=far, cuts=cuts, sampler=sampler, workers=workers,
                             near_step=near_step)
    key = key_of(observer, azimuths, far, cuts, near_step)
    kept = read(key, observer, azimuths, far)
    if kept is not None:
        return kept
    turn = horizon.sweep(observer, azimuths=azimuths, far=far, cuts=cuts, sampler=sampler, workers=workers,
                         near_step=near_step)
    write(key, turn)
    return turn


def sweep(budget: int = BUDGET_BYTES) -> int:
    """Hold the cache under its budget, the turns read least recently going first, down to 80% of it.
    Returns how many went. Never raises: a file another process holds is left for next time."""
    root = cache_dir()
    if not root.is_dir():
        return 0
    files: list[tuple[float, int, Path]] = []
    for folder, _subfolders, names in os.walk(root):
        for name in names:
            path = Path(folder) / name
            try:
                stat = path.stat()
            except OSError:
                continue
            # a part file a crashed process left behind
            if name.endswith(".part") and stat.st_mtime < time.time() - 3600:
                try:
                    path.unlink()
                except OSError:
                    pass
                continue
            files.append((stat.st_mtime, stat.st_size, path))
    total = sum(size for _, size, _ in files)
    if total <= budget:
        return 0
    dropped = 0
    for _, size, path in sorted(files):
        if total <= budget * 0.8:
            break
        try:
            path.unlink()
        except OSError:
            continue
        total -= size
        dropped += 1
    return dropped
