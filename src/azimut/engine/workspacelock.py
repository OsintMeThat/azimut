"""One Azimut per workspace, across processes.

Until the workspace could move, two instances were unlikely and mostly harmless:
the second one failed to bind port 8477 and died. That protects the *port*, not
the workspace — `azimut --port 8478` never noticed, and neither did two machines
opening one folder on a network or cloud-synced share, which is exactly what
letting people choose the folder makes common.

What actually breaks with two instances is not SQLite. Its own file locking plus
`busy_timeout` holds up on a local disk, and jobs are claimed in a transaction.
It is everything around it: `settings.json` is read-modify-written under an
*in-process* lock, so the second instance silently drops an API key or a usage
counter; startup migrations rename directories, and two of those racing is how a
case gets half-moved; and a workspace move copies a tree the other instance is
still writing into.

## How the lock works, and where it doesn't

The real mechanism is an advisory lock the operating system holds on an open
file: `fcntl.flock` on Linux and macOS, `msvcrt.locking` on Windows. What makes
it the right primitive is not that it excludes — it is that **the OS drops it
when the process dies**. A crashed Azimut can never leave a workspace bolted
shut, which is the failure mode a hand-rolled lock file always ends up having.

That lock is reliable on a local filesystem and unreliable on exactly the
filesystem this feature exists for: NFS, SMB and cloud-sync folders may honour
it partially, or not at all. So the file also carries a small payload — who,
where, since when — with a heartbeat, and the two are read together:

* the lock was refused → someone holds it, name them from the payload;
* the lock was granted and the payload names another host with a beating heart →
  the lock was probably a no-op on this filesystem, so believe the payload;
* the lock was granted and the heartbeat has stopped → take it over;
* the lock was granted and the payload names this host → a previous run of ours
  crashed, and the OS just proved nobody holds it. Take it over.

Clock skew between two machines is real and unfixable from here, which is why
`take_over()` exists: the analyst can always overrule this, and that escape
hatch is what keeps a bad verdict from bricking a workspace.
"""

from __future__ import annotations

import json
import logging
import os
import socket
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .. import __version__, config

logger = logging.getLogger(__name__)

#: The lock file, in the workspace it locks. Two workspaces are two locks, which
#: is what lets someone run a work instance and a personal one side by side.
LOCK_NAME = "lock"

#: How often the holder rewrites its timestamp. Short enough that a stale lock
#: clears in minutes, long enough to be nothing on a synced folder.
HEARTBEAT_SECONDS = 30.0

#: A heartbeat older than this, from another machine, is treated as gone. Sync
#: clients can take minutes to propagate a small file, so this is deliberately
#: several heartbeats rather than two.
STALE_AFTER_SECONDS = 300.0


class WorkspaceBusy(Exception):
    """Another Azimut holds this workspace."""

    def __init__(self, holder: dict[str, Any]):
        self.holder = holder
        super().__init__(describe(holder))


def describe(holder: dict[str, Any]) -> str:
    """The holder as a sentence, for a dialog or a console line."""
    if not holder:
        return "another Azimut is using this workspace"
    host = holder.get("host") or "another machine"
    port = holder.get("port")
    where = f"{host}:{port}" if port else host
    return f"another Azimut has this workspace open on {where}"


def lock_path(root: Path | None = None) -> Path:
    """The lock of *root*, or of the workspace in use.

    Takes a root because a folder is inspected before it is adopted: "another
    Azimut has that one" belongs in the dialog, not in a failure after the
    button.
    """
    base = config.internal_dir() if root is None else root / ".azimut"
    return base / LOCK_NAME


# -- the operating system's half ----------------------------------------------
#
# Resolved once, by what imports, rather than per call by `sys.platform`. Two
# reasons: a stdlib module that is missing should degrade to the payload rather
# than raise from inside a lock attempt, and code elsewhere legitimately fakes
# `sys.platform` to exercise a Windows path — which must not decide whether this
# module can call `msvcrt`.

try:  # POSIX
    import fcntl
except ImportError:  # pragma: no cover - exercised on Windows
    fcntl = None  # type: ignore[assignment]

try:  # Windows
    import msvcrt
except ImportError:  # pragma: no cover - exercised on POSIX
    msvcrt = None  # type: ignore[assignment]


def _try_lock(handle: Any) -> bool:
    """Take the OS lock without waiting. False means someone else holds it.

    True on a platform with neither primitive: there is no verdict to give, and
    the payload below is then the only thing standing between two instances.
    """
    try:
        if fcntl is not None:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        elif msvcrt is not None:
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError:
        return False
    return True


def _unlock(handle: Any) -> None:
    try:
        if fcntl is not None:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        elif msvcrt is not None:
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
    except OSError:  # pragma: no cover - the close below releases it anyway
        pass


# -- the payload's half --------------------------------------------------------


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _mine(port: int | None) -> dict[str, Any]:
    return {
        "pid": os.getpid(),
        "host": socket.gethostname(),
        "port": port,
        "version": __version__,
        "since": _now(),
        "at": _now(),
    }


def _read(handle: Any) -> dict[str, Any]:
    try:
        handle.seek(0)
        raw = handle.read()
    except OSError:
        return {}
    if not raw.strip():
        return {}
    try:
        payload = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _write(handle: Any, payload: dict[str, Any]) -> None:
    """Rewrite the payload in place. Binary throughout: the handle is unbuffered
    so the heartbeat lands on disk rather than in a buffer nobody flushes."""
    handle.seek(0)
    handle.write((json.dumps(payload, indent=2) + "\n").encode("utf-8"))
    try:
        handle.truncate()
        os.fsync(handle.fileno())
    except OSError:  # pragma: no cover - a share that refuses either is fine
        pass


def _age(payload: dict[str, Any]) -> float | None:
    """Seconds since the holder last wrote its heartbeat, if it can be read."""
    stamp = payload.get("at")
    if not isinstance(stamp, str):
        return None
    try:
        beat = datetime.fromisoformat(stamp)
    except ValueError:
        return None
    if beat.tzinfo is None:
        beat = beat.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - beat).total_seconds()


def _is_another_live_machine(payload: dict[str, Any]) -> bool:
    """Whether a payload we could still lock over should be believed anyway.

    Only ever true for another host: on this machine the OS lock is the
    authority, and having been granted it proves the previous holder is gone.
    """
    if not payload or payload.get("host") == socket.gethostname():
        return False
    age = _age(payload)
    return age is not None and age < STALE_AFTER_SECONDS


# -- holding it ----------------------------------------------------------------


@dataclass
class Held:
    root: Path
    handle: Any
    payload: dict[str, Any]
    stop: threading.Event


_held: Held | None = None
_guard = threading.Lock()


def held() -> bool:
    """Whether this process holds the workspace in use. Memory only, no I/O:
    it is asked on the way into every request."""
    with _guard:
        return _held is not None and _held.root == config.workspace_root()


def holder(root: Path | None = None) -> dict[str, Any] | None:
    """Who holds a workspace, when it isn't us. None means it is free."""
    target = root if root is not None else config.workspace_root()
    with _guard:
        if _held is not None and _held.root == target:
            return None
    path = lock_path(root)
    if not path.exists():
        return None
    try:
        with open(path, "r+b", buffering=0) as handle:
            taken = _try_lock(handle)
            payload = _read(handle)
            if taken:
                _unlock(handle)
                return payload if _is_another_live_machine(payload) else None
            return payload
    except OSError:
        return None


def acquire(port: int | None = None, *, force: bool = False) -> None:
    """Take this workspace for this process, or raise :class:`WorkspaceBusy`.

    Called before startup migrates anything: two processes renaming case
    directories at once is the damage this exists to prevent, so the lock has to
    come first.
    """
    global _held
    root = config.workspace_root()
    with _guard:
        if _held is not None:
            if _held.root == root:
                return
            _release_locked()

        path = lock_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        handle = open(path, "r+b" if path.exists() else "w+b", buffering=0)
        try:
            taken = _try_lock(handle)
            payload = _read(handle)
            if not taken:
                if not force:
                    raise WorkspaceBusy(payload)
                # Forced: the OS says another process holds the file, and the
                # analyst says otherwise. We cannot steal the OS lock, so the
                # payload is rewritten and this instance proceeds — the escape
                # hatch for a share where the lock is held by a ghost.
                logger.warning("taking a workspace lock held by %s", describe(payload))
            elif _is_another_live_machine(payload) and not force:
                _unlock(handle)
                raise WorkspaceBusy(payload)

            mine = _mine(port)
            _write(handle, mine)
            stop = threading.Event()
            _held = Held(root=root, handle=handle, payload=mine, stop=stop)
            threading.Thread(
                target=_beat, args=(_held,), name="azimut-workspace-lock", daemon=True
            ).start()
        except BaseException:
            handle.close()
            raise


def _beat(held: Held) -> None:
    """Keep the heartbeat fresh so another machine can tell live from crashed."""
    while not held.stop.wait(HEARTBEAT_SECONDS):
        with _guard:
            if _held is not held:
                return
            held.payload["at"] = _now()
            try:
                _write(held.handle, held.payload)
            except (OSError, ValueError):  # the volume went away; startup will say so
                return


def release() -> None:
    """Give the workspace back, and leave no payload behind to age.

    The OS would drop the lock on exit anyway. Clearing the file is what saves
    the next run from computing whether a corpse is stale.
    """
    with _guard:
        _release_locked()


def _release_locked() -> None:
    global _held
    if _held is None:
        return
    held, _held = _held, None
    held.stop.set()
    try:
        _write(held.handle, {})
        _unlock(held.handle)
    except (OSError, ValueError):
        pass
    finally:
        try:
            held.handle.close()
        except OSError:
            pass


def take_over(port: int | None = None) -> None:
    """Take the workspace whatever the lock says.

    Two machines' clocks disagree, and a sync client can leave a file behind
    that never ages out of view. Without this the verdict above could make a
    workspace permanently unopenable, so the analyst gets the last word.
    """
    acquire(port, force=True)
