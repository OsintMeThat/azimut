"""Install a newer release of the binary in place: fetch, check, try, swap, restart.

The analyst ticks "Download new versions automatically" and the binary fetches the
release beside itself: the signed manifest first (``releasesign``), then this
system's binary, hashed as it arrives, then started once with ``--version``. That is
``prepare``, run in the background. Nothing is installed until the analyst presses
Install and restart (``install``), which stops the server; the launcher then calls
``finish``, which swaps the files by renaming and starts the new binary in place of
this one.

Any failure before the swap leaves the installed binary untouched, and the pop-up
falls back to the manual download. The swap itself moves the running binary aside
to ``<name>.old`` and the new one to ``<name>``, and puts the first back if the
second move fails. ``<name>.old`` stays until the next update: it is what to rename
back if a new version will not start.

The swap waits for the very end on purpose. A PyInstaller binary reads its modules
from its own file as it imports them, reopening it each time precisely so that the
file can be renamed while it runs. Once it has been, an import would read the new
binary's bytes, so after the swap this process imports nothing and only starts the
new binary.
"""

from __future__ import annotations

import atexit
import hashlib
import logging
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Any, Callable

import httpx

from .. import __version__
from . import releasesign, updates

logger = logging.getLogger(__name__)

#: Started this way, a PyInstaller binary unpacks itself afresh instead of
#: reading the environment its parent left as if it were a child of it.
RESET_ENV = "PYINSTALLER_RESET_ENVIRONMENT"

TAG = re.compile(r"v[0-9]+(\.[0-9]+){1,3}")
TRIAL_TIMEOUT = 180  # a first start unpacks the whole binary, slow under an antivirus
CHUNK = 1 << 20
#: How the trial asks a downloaded version to load what its server serves (cli.py).
SELF_CHECK_FLAG = "--self-check"
#: How long the swap waits for work that started while the server was stopping.
SETTLE_SECONDS = 60

_lock = threading.Lock()
_state: dict[str, Any] = {"state": "idle"}
_expected: releasesign.Asset | None = None
_stop_server: Callable[[], None] | None = None
_armed: list[str] | None = None
_cancel = threading.Event()


class UpdateRefused(RuntimeError):
    """An install that cannot go ahead now. The message can be shown as it is."""


class _Cancelled(Exception):
    """The box was unticked while its download ran."""


# ---- where things are ------------------------------------------------------------


def program() -> Path | None:
    """The binary this process runs from, or None outside a frozen build."""
    if not getattr(sys, "frozen", False):
        return None
    return Path(sys.executable).resolve()


def _beside(binary: Path, mark: str) -> Path:
    # the extension stays last so a Windows binary is still an .exe that runs
    return binary.with_name(f"{binary.stem}.{mark}{binary.suffix}")


def staged_path(binary: Path) -> Path:
    return _beside(binary, "new")


def old_path(binary: Path) -> Path:
    return _beside(binary, "old")


def _part_path(binary: Path) -> Path:
    return staged_path(binary).with_name(staged_path(binary).name + ".part")


# ---- whether this copy can update itself ---------------------------------------------


_writable: dict[Path, bool] = {}


def _folder_writable(folder: Path) -> bool:
    """Answered once per folder: the progress is polled, and every probe is a file
    written beside the binary for an antivirus to look at."""
    if folder not in _writable:
        probe = folder / f".azimut-write-test-{os.getpid()}"
        try:
            probe.write_bytes(b"")
            probe.unlink()
            _writable[folder] = True
        except OSError:
            _writable[folder] = False
    return _writable[folder]


def unsupported_reason() -> str | None:
    """Why this copy cannot install updates itself, or None when it can."""
    binary = program()
    if binary is None:
        return "A pip install updates with its own command."
    if updates.asset_name() is None:
        return "No binary is built for this system; update from the release page."
    if not _folder_writable(binary.parent):
        return "Azimut can't write to its own folder. Move it to a folder of yours to use this."
    return None


def busy_reason() -> str | None:
    """What a restart would cut short, or None when nothing is at work."""
    from .. import jobs
    from . import horizon_finds, workqueue, workspacemove

    if workspacemove.in_progress():
        return "Waits for the workspace move to finish."
    kinds = jobs.running()
    if "download" in kinds:
        return "Waits for the media download to finish."
    if kinds or workqueue.busy():
        return "Waits for the work in progress to finish."
    if horizon_finds.sight_running():
        return "Waits for the Find check to finish."
    return None


def status() -> dict[str, Any]:
    """Where the update stands. Reads no network."""
    with _lock:
        state = dict(_state)
    reason = unsupported_reason()
    return {
        **state,
        "supported": reason is None,
        "reason": reason,
        "busy": busy_reason() if state["state"] == "ready" else None,
    }


# ---- fetching and checking --------------------------------------------------------


def _set(**fields: Any) -> None:
    with _lock:
        _state.clear()
        _state.update(fields)


def _progress(done: int) -> None:
    with _lock:
        _state["done"] = done


def _get(client: httpx.Client, url: str, limit: int) -> bytes:
    with client.stream("GET", url) as response:
        if response.status_code == 404:
            # the window between a tag and its signing, when the release has no manifest yet
            raise UpdateRefused("This release is not signed yet. Download it by hand, or try again later.")
        response.raise_for_status()
        body = bytearray()
        for chunk in response.iter_bytes():
            body += chunk
            if len(body) > limit:
                raise releasesign.ManifestRefused("The release's manifest is too large to be one.")
    return bytes(body)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _matches(path: Path, expected: releasesign.Asset) -> bool:
    try:
        return path.stat().st_size == expected.size and _sha256(path) == expected.sha256
    except OSError:
        return False


def _download(client: httpx.Client, url: str, expected: releasesign.Asset, target: Path) -> None:
    """Stream ``url`` to ``target``, refusing a byte past the size the manifest states."""
    digest = hashlib.sha256()
    done = 0
    with client.stream("GET", url) as response, target.open("wb") as out:
        response.raise_for_status()
        for chunk in response.iter_bytes(CHUNK):
            if _cancel.is_set():
                raise _Cancelled()
            done += len(chunk)
            if done > expected.size:
                raise UpdateRefused("The download is larger than the release states.")
            digest.update(chunk)
            out.write(chunk)
            _progress(done)
    if done != expected.size or digest.hexdigest() != expected.sha256:
        raise UpdateRefused("The download does not match the release's signed manifest.")


def _fresh_environment() -> dict[str, str]:
    return {**os.environ, RESET_ENV: "1"}


def _quiet() -> int:
    """No console window for the trial run on Windows."""
    return getattr(subprocess, "CREATE_NO_WINDOW", 0)


def trial(binary: Path, version: str) -> None:
    """Start ``binary`` once with ``--self-check``: it loads everything its server
    serves, native libraries included, and answers "azimut <version> ok".

    Its answer goes to a file rather than a pipe. On Windows the timeout ends the
    bootloader only, and a pipe the unpacked child still held would keep the wait
    going past it."""
    with tempfile.TemporaryFile() as out:
        try:
            done = subprocess.run(
                [str(binary), SELF_CHECK_FLAG],
                stdin=subprocess.DEVNULL,
                stdout=out,
                stderr=subprocess.DEVNULL,
                timeout=TRIAL_TIMEOUT,
                env=_fresh_environment(),
                creationflags=_quiet(),
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise UpdateRefused(f"The new version did not start: {exc}") from exc
        out.seek(0)
        lines = out.read().decode("utf-8", "replace").strip().splitlines()
    if done.returncode != 0 or lines[-1:] != [f"azimut {version} ok"]:
        raise UpdateRefused(f"The new version did not start as {version} on this computer.")


def _make_runnable(staged: Path, binary: Path) -> None:
    if os.name != "nt":
        staged.chmod(binary.stat().st_mode & 0o777 | 0o700)


def _remove(*paths: Path) -> None:
    for path in paths:
        try:
            path.unlink()
        except OSError:
            pass


def _fetch(tag: str, binary: Path, client: httpx.Client) -> None:
    global _expected
    asset = updates.asset_name()
    manifest_url = updates.download_url(tag, releasesign.MANIFEST_ASSET)
    signature_url = updates.download_url(tag, releasesign.SIGNATURE_ASSET)
    manifest = _get(client, manifest_url, releasesign.MANIFEST_LIMIT)
    signature = _get(client, signature_url, releasesign.SIGNATURE_LIMIT)
    found = releasesign.read(manifest, signature, tag=tag, current=__version__)
    expected = found.assets.get(asset or "")
    if expected is None:
        raise UpdateRefused("The release has no signed binary for this system.")
    _set(state="downloading", version=found.version, done=0, total=expected.size)
    staged, part = staged_path(binary), _part_path(binary)
    if not _matches(staged, expected):
        _remove(staged)
        try:
            _download(client, updates.download_url(tag, asset or ""), expected, part)
            part.replace(staged)
        finally:
            _remove(part)
    if _cancel.is_set():
        raise _Cancelled()
    _make_runnable(staged, binary)
    _set(state="checking", version=found.version, done=expected.size, total=expected.size)
    # A trial that fails keeps the file: it matches the signed manifest, so the next
    # try only starts it again rather than downloading it all over.
    trial(staged, found.version)
    if _cancel.is_set():
        raise _Cancelled()
    with _lock:
        _expected = expected
    _set(state="ready", version=found.version, done=expected.size, total=expected.size)


def _client() -> httpx.Client:
    return httpx.Client(
        timeout=httpx.Timeout(30.0, connect=10.0),
        follow_redirects=True,
        headers={"User-Agent": "azimut"},
    )


def prepare(
    tag: str,
    *,
    retry: bool = False,
    client: Callable[[], httpx.Client] = _client,
    wait: bool = False,
) -> dict[str, Any]:
    """Fetch, check and try release ``tag`` in the background. Installs nothing.

    A second call while one is under way, or once that release is ready, changes
    nothing; nor does one for a release that already failed in this run, unless
    ``retry`` (Try again) asks, so a failure costs one download per start at most.
    ``wait`` runs it in the calling thread instead, for tests."""
    reason = unsupported_reason()
    if reason:
        raise UpdateRefused(reason)
    if not TAG.fullmatch(tag):
        raise UpdateRefused(f"{tag!r} is not a release.")
    binary = program()
    assert binary is not None  # unsupported_reason said so
    with _lock:
        under_way = _state["state"] in {"downloading", "checking"}
        same = _state.get("version") == tag[1:]
        settled = same and (_state["state"] == "ready" or (_state["state"] == "failed" and not retry))
        if under_way and same:
            _cancel.clear()  # ticked again before an untick had stopped it: it carries on
        if not (under_way or settled):
            _cancel.clear()
            _state.clear()
            _state.update(state="downloading", version=tag[1:], done=0, total=0)
    if under_way or settled:
        return status()  # outside the lock, which status takes itself

    def work() -> None:
        try:
            with client() as http:
                _fetch(tag, binary, http)
        except _Cancelled:
            _remove(staged_path(binary), _part_path(binary))
            _set(state="idle")
        except (UpdateRefused, releasesign.ManifestRefused) as exc:
            _set(state="failed", version=tag[1:], error=str(exc))
        except (httpx.HTTPError, OSError) as exc:
            logger.warning("update %s failed: %r", tag, exc)
            _set(state="failed", version=tag[1:], error="The download did not complete.")

    if wait:
        work()
    else:
        threading.Thread(target=work, name="azimut-self-update", daemon=True).start()
    return status()


def discard() -> None:
    """Forget a prepared update and its file, when the box is unticked. A download
    under way stops at its next chunk and takes its file away itself."""
    global _expected
    binary = program()
    with _lock:
        if _state["state"] in {"downloading", "checking"}:
            _cancel.set()
            return
        _state.clear()
        _state.update(state="idle")
        _expected = None
    if binary is not None:
        _remove(staged_path(binary), _part_path(binary))


# ---- installing ---------------------------------------------------------------------


def on_restart(stop: Callable[[], None] | None) -> None:
    """The launcher hands over how to stop its server; None outside the launcher."""
    global _stop_server
    _stop_server = stop


def install(port: int) -> dict[str, Any]:
    """Arm the swap and stop the server; ``finish`` does the rest once it has.

    Refused, with the reason, when nothing is ready, when work is under way that a
    restart would cut short, or when this copy was not started by the launcher."""
    global _armed
    binary = program()
    with _lock:
        ready = _state["state"] == "ready"
        version, expected = _state.get("version"), _expected
    if binary is None or not ready or expected is None:
        raise UpdateRefused("Nothing is ready to install.")
    busy = busy_reason()
    if busy:
        raise UpdateRefused(busy)
    if _stop_server is None or not port:
        raise UpdateRefused("This copy of Azimut can't restart itself.")
    if not _matches(staged_path(binary), expected):
        discard()
        raise UpdateRefused("The downloaded version changed on disk; download it again.")
    _armed = [str(binary), "--no-browser", "--port", str(port)]
    stop = _stop_server
    # a moment's grace so the answer reaches the tab before the server goes
    threading.Timer(0.3, stop).start()
    return {"restarting": True, "version": version}


def _replace(source: Path, target: Path, tries: int = 10) -> None:
    """``os.replace``, waiting out an antivirus that holds a fresh file for a moment."""
    for attempt in range(tries):
        try:
            os.replace(source, target)
            return
        except PermissionError:
            if attempt == tries - 1:
                raise
            time.sleep(0.5)


def swap(binary: Path, staged: Path, old: Path) -> None:
    """``binary`` aside to ``old``, ``staged`` in its place, or nothing moved at all."""
    if old.exists():
        old.unlink()
    _replace(binary, old)
    try:
        _replace(staged, binary)
    except OSError:
        _replace(old, binary)
        raise


def _settle(timeout: float = SETTLE_SECONDS) -> None:
    """Let work that started while the server was stopping end before the swap: the
    press checked nothing was at work, but a request already in flight may start some.
    The server no longer answers, so nothing new can begin while this waits."""
    deadline = time.monotonic() + timeout
    while busy_reason() and time.monotonic() < deadline:
        time.sleep(0.5)


def relaunch(command: list[str]) -> None:
    """Become the new binary. On Windows, start it in this console and end here."""
    environment = _fresh_environment()
    if os.name == "nt":
        subprocess.Popen(command, env=environment)
        os._exit(0)
    os.execve(command[0], command, environment)


def finish() -> None:
    """After the server has stopped: swap the files and start the new binary.

    Exit work runs first (the workspace lock, staged exports), since after the swap
    this process must import nothing. A swap that fails starts the old binary again,
    so the tab comes back either way and says what happened."""
    global _armed
    command, _armed = _armed, None
    if command is None:
        return
    binary = Path(command[0])
    staged, old = staged_path(binary), old_path(binary)
    _settle()
    atexit._run_exitfuncs()
    try:
        swap(binary, staged, old)
        swapped = True
    except OSError as exc:
        swapped = False
        _say(f"The update could not be installed ({exc}). Azimut {__version__} starts again.")
    if swapped:
        _say(f"Installing Azimut {_state.get('version')}... done. Previous version kept as {old.name}.")
    if not binary.exists():
        _say(f"Rename {old.name} back to {binary.name} to start Azimut.")
        time.sleep(30)
        os._exit(1)
    try:
        relaunch(command)
    except OSError as exc:
        # the new binary would not start at all: the old one goes back and starts instead
        _say(f"Azimut {_state.get('version')} would not start ({exc}).")
        if swapped:
            try:
                _replace(binary, staged)
                _replace(old, binary)
            except OSError:
                _say(f"Rename {old.name} back to {binary.name} to start Azimut.")
                time.sleep(30)
                os._exit(1)
        try:
            relaunch(command)
        except OSError as again:
            _say(f"Azimut could not start again ({again}). Start it yourself.")
            time.sleep(30)
            os._exit(1)


def _say(line: str) -> None:
    """A line in the console, which a closed or broken console must not stop."""
    try:
        print(line, flush=True)
    except (OSError, ValueError):
        pass
