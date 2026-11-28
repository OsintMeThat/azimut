"""The one-click update: fetch, check and try a release beside the binary, then swap
and restart only on the analyst's press (engine/selfupdate.py, api/settings.py).

Nothing here reaches the network or the real signing key. GitHub is a mock
transport, the release is signed by a key the test makes, and the binary is a few
bytes in a temporary folder standing in for a frozen build.
"""

from __future__ import annotations

import base64
import json
import os
import shutil
import subprocess
import sys
import threading
from pathlib import Path

import httpx
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from azimut import config, jobs
from azimut.engine import releasesign, selfupdate, updates, workspacemove

ASSET = "azimut-linux-x86_64"
NEW = b"the new binary " * 1000
TAG = "v9.9.9"


def public_line(key: Ed25519PrivateKey) -> str:
    raw = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return base64.b64encode(raw).decode()


def manifest_for(binary: bytes, *, version: str = "9.9.9", asset: str = ASSET) -> bytes:
    import hashlib

    body = {
        "format": 1,
        "project": "azimut",
        "version": version,
        "assets": {asset: {"sha256": hashlib.sha256(binary).hexdigest(), "size": len(binary)}},
    }
    return json.dumps(body).encode()


class Release:
    """GitHub's release downloads, mocked: what it serves and what was asked."""

    def __init__(self, key: Ed25519PrivateKey, binary: bytes = NEW, manifest: bytes | None = None):
        self.manifest = manifest if manifest is not None else manifest_for(binary)
        self.signature = base64.b64encode(key.sign(self.manifest))
        self.binary = binary
        self.asked: list[str] = []
        self.fail_binary = False
        self.manifest_missing = False

    def handler(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        self.asked.append(url)
        if url == updates.download_url(TAG, releasesign.MANIFEST_ASSET):
            if self.manifest_missing:
                return httpx.Response(404)
            return httpx.Response(200, content=self.manifest)
        if url == updates.download_url(TAG, releasesign.SIGNATURE_ASSET):
            return httpx.Response(200, content=self.signature)
        if url == updates.download_url(TAG, ASSET):
            # GitHub answers a release download with a redirect to its file host
            return httpx.Response(302, headers={"Location": "https://objects.example/blob"})
        if url == "https://objects.example/blob":
            if self.fail_binary:
                raise httpx.ConnectError("the line went down")
            return httpx.Response(200, content=self.binary)
        return httpx.Response(404)

    def client(self) -> httpx.Client:
        return httpx.Client(
            transport=httpx.MockTransport(lambda request: self.handler(request)), follow_redirects=True
        )

    @property
    def binary_asked(self) -> bool:
        return "https://objects.example/blob" in self.asked


@pytest.fixture
def key(monkeypatch) -> Ed25519PrivateKey:
    made = Ed25519PrivateKey.generate()
    monkeypatch.setattr(releasesign, "TRUSTED_KEYS", (public_line(made),))
    return made


@pytest.fixture
def binary(tmp_path, monkeypatch) -> Path:
    """A frozen build of 0.3.4 in a folder of the analyst's, idle and untouched."""
    program = tmp_path / "Apps" / ASSET
    program.parent.mkdir()
    program.write_bytes(b"the old binary")
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "executable", str(program))
    monkeypatch.setattr(updates, "asset_name", lambda *a, **k: ASSET)
    monkeypatch.setattr(selfupdate, "__version__", "0.3.4")
    monkeypatch.delenv(updates.SOURCE_ENV, raising=False)
    monkeypatch.setattr(selfupdate, "_state", {"state": "idle"})
    monkeypatch.setattr(selfupdate, "_expected", None)
    monkeypatch.setattr(selfupdate, "_armed", None)
    monkeypatch.setattr(selfupdate, "_stop_server", None)
    monkeypatch.setattr(selfupdate, "_writable", {})
    return program.resolve()


@pytest.fixture
def tried(monkeypatch) -> list[tuple[Path, str]]:
    calls: list[tuple[Path, str]] = []
    monkeypatch.setattr(selfupdate, "trial", lambda path, version: calls.append((path, version)))
    return calls


def prepare(release: Release) -> dict:
    return selfupdate.prepare(TAG, client=release.client, wait=True)


# -- prepare: fetch, check, try --------------------------------------------------


def test_a_release_is_fetched_checked_and_tried_then_waits_for_a_press(key, binary, tried):
    release = Release(key)
    state = prepare(release)
    assert state["state"] == "ready" and state["version"] == "9.9.9"
    assert state["done"] == state["total"] == len(NEW)
    staged = selfupdate.staged_path(binary)
    assert staged.read_bytes() == NEW
    assert binary.read_bytes() == b"the old binary"  # nothing installed
    assert tried == [(staged, "9.9.9")]
    assert sorted(p.name for p in binary.parent.iterdir()) == sorted([binary.name, staged.name])


def test_a_manifest_another_key_signed_fetches_no_binary(key, binary, tried):
    release = Release(Ed25519PrivateKey.generate())
    state = prepare(release)
    assert state["state"] == "failed"
    assert "signature" in state["error"]
    assert not release.binary_asked
    assert [p.name for p in binary.parent.iterdir()] == [binary.name]


def test_a_download_that_differs_from_the_manifest_is_thrown_away(key, binary, tried):
    release = Release(key)
    release.binary = b"x" * len(NEW)  # same size, other bytes
    state = prepare(release)
    assert state["state"] == "failed" and "does not match" in state["error"]
    assert [p.name for p in binary.parent.iterdir()] == [binary.name]
    assert tried == []


def test_a_download_larger_than_stated_stops_there(key, binary, tried):
    release = Release(key)
    release.binary = NEW + b"more"
    state = prepare(release)
    assert state["state"] == "failed" and "larger" in state["error"]
    assert [p.name for p in binary.parent.iterdir()] == [binary.name]


def test_a_release_without_this_systems_binary_is_refused(key, binary, tried):
    release = Release(key, manifest=manifest_for(NEW, asset="azimut-macos-arm64"))
    state = prepare(release)
    assert state["state"] == "failed" and "no signed binary for this system" in state["error"]
    assert not release.binary_asked


def test_a_cut_download_says_so_and_leaves_nothing(key, binary, tried):
    release = Release(key)
    release.fail_binary = True
    state = prepare(release)
    assert state["state"] == "failed" and state["error"] == "The download did not complete."
    assert [p.name for p in binary.parent.iterdir()] == [binary.name]


def test_a_version_that_does_not_start_is_kept_for_the_next_try_without_a_new_download(
    key, binary, monkeypatch
):
    """It matches the signed manifest, so trying again only starts it again: a
    version an antivirus blocks costs one download, not one per start."""
    def refuse(path, version):
        raise selfupdate.UpdateRefused("The new version did not start as 9.9.9 on this computer.")

    monkeypatch.setattr(selfupdate, "trial", refuse)
    release = Release(key)
    state = prepare(release)
    assert state["state"] == "failed" and "did not start" in state["error"]
    assert selfupdate.staged_path(binary).read_bytes() == NEW
    assert binary.read_bytes() == b"the old binary"
    tried = []
    monkeypatch.setattr(selfupdate, "trial", lambda path, version: tried.append(version))
    downloads = release.asked.count("https://objects.example/blob")
    assert selfupdate.prepare(TAG, retry=True, client=release.client, wait=True)["state"] == "ready"
    assert release.asked.count("https://objects.example/blob") == downloads
    assert tried == ["9.9.9"]


def test_a_failed_release_is_tried_again_only_when_asked(key, binary, tried):
    release = Release(key)
    release.fail_binary = True
    prepare(release)
    asked = len(release.asked)
    assert prepare(release)["state"] == "failed"  # the next page load: left alone
    assert len(release.asked) == asked
    release.fail_binary = False
    assert selfupdate.prepare(TAG, retry=True, client=release.client, wait=True)["state"] == "ready"


def test_a_release_not_signed_yet_says_so(key, binary, tried):
    release = Release(key)
    release.manifest_missing = True
    state = prepare(release)
    assert state["state"] == "failed" and "not signed yet" in state["error"]
    assert not release.binary_asked


def test_unticking_stops_a_download_under_way_and_takes_its_file_away(key, binary, tried):
    release = Release(key)
    original = release.handler

    def untick_midway(request):
        answer = original(request)
        if str(request.url) == "https://objects.example/blob":
            selfupdate.discard()  # the box unticked while the bytes arrive
            return httpx.Response(200, content=NEW[: len(NEW) // 2] + NEW[len(NEW) // 2 :])
        return answer

    release.handler = untick_midway
    state = prepare(release)
    assert state["state"] == "idle"
    assert [p.name for p in binary.parent.iterdir()] == [binary.name]
    assert tried == []


def test_a_file_already_downloaded_is_not_fetched_again(key, binary, tried):
    selfupdate.staged_path(binary).write_bytes(NEW)
    release = Release(key)
    assert prepare(release)["state"] == "ready"
    assert not release.binary_asked
    assert len(tried) == 1  # tried again all the same


def test_an_older_release_is_refused(key, binary, tried, monkeypatch):
    monkeypatch.setattr(selfupdate, "__version__", "9.9.9")
    release = Release(key)
    state = prepare(release)
    assert state["state"] == "failed" and "not newer" in state["error"]
    assert not release.binary_asked


def test_a_second_prepare_of_a_ready_release_changes_nothing(key, binary, tried):
    release = Release(key)
    prepare(release)
    asked = len(release.asked)
    assert prepare(release)["state"] == "ready"
    assert len(release.asked) == asked


def test_a_pip_install_prepares_nothing(monkeypatch):
    monkeypatch.setattr(sys, "frozen", False, raising=False)
    with pytest.raises(selfupdate.UpdateRefused, match="pip"):
        selfupdate.prepare(TAG, client=lambda: pytest.fail("no network"), wait=True)


def test_something_that_is_not_a_tag_prepares_nothing(binary):
    with pytest.raises(selfupdate.UpdateRefused, match="not a release"):
        selfupdate.prepare("../../evil", client=lambda: pytest.fail("no network"), wait=True)


@pytest.mark.skipif(os.name == "nt" or os.geteuid() == 0, reason="POSIX folder modes")
def test_a_binary_in_a_folder_it_cannot_write_says_how_to_fix_it(binary):
    binary.parent.chmod(0o500)
    try:
        state = selfupdate.status()
        assert state["supported"] is False
        assert "can't write to its own folder" in state["reason"]
        with pytest.raises(selfupdate.UpdateRefused, match="own folder"):
            selfupdate.prepare(TAG, client=lambda: pytest.fail("no network"), wait=True)
    finally:
        binary.parent.chmod(0o700)


@pytest.mark.skipif(os.name == "nt", reason="a shell script stands in for the binary")
def test_the_trial_starts_the_binary_afresh_and_reads_its_version(tmp_path):
    fake = tmp_path / "azimut.new"
    # answers only when started with PyInstaller's environment reset, as the real one must be
    fake.write_text(
        '#!/bin/sh\n[ "$1" = --self-check ] && [ "$PYINSTALLER_RESET_ENVIRONMENT" = 1 ] '
        '&& echo "loading..." && echo "azimut 9.9.9 ok"\n'
    )
    fake.chmod(0o755)
    selfupdate.trial(fake, "9.9.9")
    with pytest.raises(selfupdate.UpdateRefused, match="did not start as 9.9.8"):
        selfupdate.trial(fake, "9.9.8")


@pytest.mark.skipif(os.name == "nt", reason="a shell script stands in for the binary")
def test_a_trial_that_hangs_is_given_up_on_time(tmp_path, monkeypatch):
    fake = tmp_path / "azimut.new"
    fake.write_text("#!/bin/sh\nsleep 30\n")
    fake.chmod(0o755)
    monkeypatch.setattr(selfupdate, "TRIAL_TIMEOUT", 1)
    started = __import__("time").monotonic()
    with pytest.raises(selfupdate.UpdateRefused, match="did not start"):
        selfupdate.trial(fake, "9.9.9")
    assert __import__("time").monotonic() - started < 10


def test_the_trial_asks_for_the_self_check_every_version_answers():
    """An installed copy tries the next version with this flag: the two must agree."""
    from azimut import cli

    assert selfupdate.SELF_CHECK_FLAG == cli.SELF_CHECK_FLAG == "--self-check"


def test_the_self_check_loads_the_server_and_opens_no_workspace(tmp_path):
    env = {**os.environ, "AZIMUT_HOME": str(tmp_path / "workspace"), "PYTHONPATH": str(Path(selfupdate.__file__).parents[2])}
    done = subprocess.run(
        [sys.executable, "-c", "from azimut.cli import main; main()", "--self-check"],
        capture_output=True, text=True, timeout=180, env=env,
    )
    assert done.returncode == 0, done.stderr[-2000:]
    from azimut import __version__

    assert done.stdout.strip().splitlines()[-1] == f"azimut {__version__} ok"
    assert not (tmp_path / "workspace").exists()


def test_a_binary_that_will_not_run_fails_the_trial(tmp_path):
    with pytest.raises(selfupdate.UpdateRefused, match="did not start"):
        selfupdate.trial(tmp_path / "missing", "9.9.9")


# -- install: only on a press, only when nothing is at work ------------------------


def armed_server():
    stopped = threading.Event()
    selfupdate.on_restart(stopped.set)
    return stopped


def test_nothing_ready_installs_nothing(binary):
    armed_server()
    with pytest.raises(selfupdate.UpdateRefused, match="Nothing is ready"):
        selfupdate.install(8477)


def test_install_stops_the_server_and_leaves_the_swap_for_after(key, binary, tried):
    prepare(Release(key))
    stopped = armed_server()
    assert selfupdate.install(8477) == {"restarting": True, "version": "9.9.9"}
    assert stopped.wait(5)
    assert binary.read_bytes() == b"the old binary"  # swapped only once the server is gone


@pytest.mark.parametrize(
    ("busy", "reason"),
    [
        ("download", "media download"),
        ("sheet-proofs", "work in progress"),
        ("move", "workspace move"),
    ],
)
def test_work_under_way_holds_the_install_back(key, binary, tried, monkeypatch, busy, reason):
    prepare(Release(key))
    if busy == "move":
        monkeypatch.setattr(workspacemove, "in_progress", lambda: True)
    else:
        monkeypatch.setattr(jobs, "running", lambda: [busy])
    assert reason in selfupdate.status()["busy"]
    stopped = armed_server()
    with pytest.raises(selfupdate.UpdateRefused, match=reason):
        selfupdate.install(8477)
    assert not stopped.is_set()


def test_a_copy_the_launcher_did_not_start_cannot_restart_itself(key, binary, tried):
    prepare(Release(key))
    with pytest.raises(selfupdate.UpdateRefused, match="can't restart itself"):
        selfupdate.install(8477)


def test_a_staged_file_changed_since_it_was_checked_is_not_installed(key, binary, tried):
    prepare(Release(key))
    selfupdate.staged_path(binary).write_bytes(b"swapped behind our back")
    armed_server()
    with pytest.raises(selfupdate.UpdateRefused, match="changed on disk"):
        selfupdate.install(8477)
    assert not selfupdate.staged_path(binary).exists()


# -- finish: swap, then start the new binary --------------------------------------


@pytest.fixture
def relaunched(monkeypatch) -> list[list[str]]:
    calls: list[list[str]] = []
    monkeypatch.setattr(selfupdate, "relaunch", calls.append)
    exits: list[bool] = []
    monkeypatch.setattr(selfupdate.atexit, "_run_exitfuncs", lambda: exits.append(True))
    return calls


def test_finish_swaps_the_files_and_starts_the_new_binary_on_the_same_port(
    key, binary, tried, relaunched
):
    prepare(Release(key))
    armed_server()
    selfupdate.install(8477)
    selfupdate.finish()
    assert binary.read_bytes() == NEW
    assert selfupdate.old_path(binary).read_bytes() == b"the old binary"
    assert not selfupdate.staged_path(binary).exists()
    assert relaunched == [[str(binary), "--no-browser", "--port", "8477"]]


def test_finish_without_a_press_does_nothing(binary, relaunched):
    selfupdate.finish()
    assert relaunched == []
    assert binary.read_bytes() == b"the old binary"


def test_a_swap_that_fails_puts_the_old_binary_back_and_starts_it(key, binary, tried, relaunched):
    prepare(Release(key))
    armed_server()
    selfupdate.install(8477)
    selfupdate.staged_path(binary).unlink()  # the second move can only fail now
    selfupdate.finish()
    assert binary.read_bytes() == b"the old binary"
    assert not selfupdate.old_path(binary).exists()
    assert relaunched == [[str(binary), "--no-browser", "--port", "8477"]]


def test_a_new_binary_that_will_not_start_gives_way_to_the_old_one(
    key, binary, tried, monkeypatch
):
    prepare(Release(key))
    armed_server()
    selfupdate.install(8477)
    monkeypatch.setattr(selfupdate.atexit, "_run_exitfuncs", lambda: None)
    started = []

    def relaunch(command):
        started.append(Path(command[0]).read_bytes())
        if len(started) == 1:
            raise OSError("Exec format error")

    monkeypatch.setattr(selfupdate, "relaunch", relaunch)
    selfupdate.finish()
    assert started == [NEW, b"the old binary"]
    assert binary.read_bytes() == b"the old binary"
    assert selfupdate.staged_path(binary).read_bytes() == NEW  # kept for another try


def test_work_started_while_stopping_ends_before_the_swap(key, binary, tried, relaunched, monkeypatch):
    prepare(Release(key))
    armed_server()
    selfupdate.install(8477)
    answers = iter(["Waits for the media download to finish.", "Waits for the media download to finish.", None])
    monkeypatch.setattr(selfupdate, "busy_reason", lambda: next(answers, None))
    monkeypatch.setattr(selfupdate.time, "sleep", lambda seconds: None)
    selfupdate.finish()
    assert binary.read_bytes() == NEW
    assert next(answers, "drained") == "drained"


def test_a_broken_console_does_not_stop_the_restart(key, binary, tried, relaunched, monkeypatch):
    prepare(Release(key))
    armed_server()
    selfupdate.install(8477)

    def broken(*args, **kwargs):
        raise OSError("the console is gone")

    monkeypatch.setattr("builtins.print", broken)
    selfupdate.finish()
    assert binary.read_bytes() == NEW
    assert len(relaunched) == 1


def test_nothing_is_imported_between_the_swap_and_the_new_start(key, binary, tried, monkeypatch):
    """A PyInstaller binary reads its modules from its own file as it imports them,
    so once the file is swapped an import would read the new binary's bytes."""
    prepare(Release(key))
    armed_server()
    selfupdate.install(8477)
    monkeypatch.setattr(selfupdate.atexit, "_run_exitfuncs", lambda: None)
    imported: list[str] = []

    class Watch:
        def find_spec(self, name, path=None, target=None):
            imported.append(name)
            return None

    watch = Watch()
    real_swap = selfupdate.swap

    def swap_then_watch(*args):
        real_swap(*args)
        sys.meta_path.insert(0, watch)

    def relaunch(command):
        sys.meta_path.remove(watch)

    monkeypatch.setattr(selfupdate, "swap", swap_then_watch)
    monkeypatch.setattr(selfupdate, "relaunch", relaunch)
    selfupdate.finish()
    assert imported == []


def test_a_swap_replaces_the_previous_old_binary(tmp_path):
    binary, staged, old = tmp_path / "azimut", tmp_path / "azimut.new", tmp_path / "azimut.old"
    binary.write_bytes(b"2"), staged.write_bytes(b"3"), old.write_bytes(b"1")
    selfupdate.swap(binary, staged, old)
    assert (binary.read_bytes(), old.read_bytes(), staged.exists()) == (b"3", b"2", False)


def test_a_windows_binary_keeps_its_extension_beside_itself(tmp_path):
    exe = tmp_path / "azimut-windows-x86_64.exe"
    assert selfupdate.staged_path(exe).name == "azimut-windows-x86_64.new.exe"
    assert selfupdate.old_path(exe).name == "azimut-windows-x86_64.old.exe"


def test_a_running_binary_can_be_swapped(tmp_path):
    """Windows refuses to delete a running program but lets it be renamed, which is
    the whole swap. Proven on each CI system with a real program that is running."""
    if os.name == "nt":
        source = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "PING.EXE"
        held = tmp_path / "held.exe"
        args = ["-n", "30", "127.0.0.1"]
    else:
        source = Path(shutil.which("sleep") or "/bin/sleep")
        held = tmp_path / "held"
        args = ["30"]
    shutil.copy2(source, held)
    staged = tmp_path / ("held.new" + held.suffix)
    staged.write_bytes(b"the new one")
    running = subprocess.Popen([str(held), *args], stdout=subprocess.DEVNULL)
    try:
        selfupdate.swap(held, staged, selfupdate.old_path(held))
        assert held.read_bytes() == b"the new one"
        assert running.poll() is None  # still running, from the file moved aside
    finally:
        running.kill()
        running.wait()


def test_the_new_binary_starts_afresh_with_the_same_arguments(monkeypatch):
    seen: dict = {}
    if os.name == "nt":
        monkeypatch.setattr(
            selfupdate.subprocess, "Popen", lambda cmd, env: seen.update(cmd=cmd, env=env)
        )
        monkeypatch.setattr(selfupdate.os, "_exit", lambda code: seen.update(code=code))
    else:
        monkeypatch.setattr(
            selfupdate.os, "execve", lambda path, cmd, env: seen.update(path=path, cmd=cmd, env=env)
        )
    selfupdate.relaunch(["/apps/azimut", "--no-browser", "--port", "8477"])
    assert seen["cmd"] == ["/apps/azimut", "--no-browser", "--port", "8477"]
    assert seen["env"][selfupdate.RESET_ENV] == "1"


def test_discard_takes_the_waiting_file_away(key, binary, tried):
    prepare(Release(key))
    selfupdate.discard()
    assert selfupdate.status()["state"] == "idle"
    assert [p.name for p in binary.parent.iterdir()] == [binary.name]


# -- the routes: the box is the say-so -----------------------------------------------


def test_prepare_is_refused_while_the_box_is_unticked(client, monkeypatch):
    monkeypatch.setattr(selfupdate, "prepare", lambda *a, **k: pytest.fail("must not download"))
    answer = client.post("/api/settings/update/prepare", json={"tag": TAG})
    assert answer.status_code == 409
    assert "off" in answer.json()["detail"]


def test_prepare_with_the_box_ticked_asks_the_engine(client, monkeypatch):
    client.put("/api/settings/prefs", json={"update_auto_download": True})
    asked = []
    monkeypatch.setattr(
        selfupdate, "prepare", lambda tag, retry: asked.append((tag, retry)) or {"state": "downloading"}
    )
    answer = client.post("/api/settings/update/prepare", json={"tag": TAG})
    assert answer.json() == {"state": "downloading"}
    client.post("/api/settings/update/prepare", json={"tag": TAG, "retry": True})
    assert asked == [(TAG, False), (TAG, True)]


def test_a_pip_install_is_told_why_with_the_box_ticked(client):
    client.put("/api/settings/prefs", json={"update_auto_download": True})
    answer = client.post("/api/settings/update/prepare", json={"tag": TAG})
    assert answer.status_code == 409 and "pip" in answer.json()["detail"]


def test_install_with_nothing_ready_is_refused(client):
    answer = client.post("/api/settings/update/install")
    assert answer.status_code == 409


def test_the_box_is_off_until_ticked_and_unticking_it_discards(client, monkeypatch):
    assert config.DEFAULT_SETTINGS["update_auto_download"] is False
    assert client.get("/api/settings").json()["update_auto_download"] is False
    discarded = []
    monkeypatch.setattr(selfupdate, "discard", lambda: discarded.append(True))
    client.put("/api/settings/prefs", json={"update_auto_download": True})
    assert client.get("/api/settings").json()["update_auto_download"] is True
    assert discarded == []
    client.put("/api/settings/prefs", json={"update_auto_download": False})
    assert discarded == [True]


STOP_PROBE = """
import socket, sys, threading, time
import httpx
from azimut import launcher
from azimut.api import events
if sys.argv[1] == "without":
    events.end_streams = lambda: None
launcher.RESTART_GRACE = 60.0  # the streams must end themselves
with socket.socket() as probe:
    probe.bind(("127.0.0.1", 0))
    port = probe.getsockname()[1]
server = launcher._build_server(port)
serving = threading.Thread(target=server.run, daemon=True)
serving.start()
while not server.started:
    time.sleep(0.05)
with httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=30) as http:
    with http.stream("GET", "/api/events") as stream:
        # held, as a tab holds it: a dropped iterator would close the connection
        lines = stream.iter_lines()
        assert next(lines) == ": connected"
        launcher._stop_for_restart(server)
        serving.join(timeout=6)
        print("stopped" if not serving.is_alive() else "still serving", flush=True)
"""


@pytest.mark.parametrize(("ending", "expected"), [("with", "stopped"), ("without", "still serving")])
def test_a_stop_for_restart_ends_the_event_streams_and_lets_the_port_go(tmp_path, ending, expected):
    """uvicorn waits for open responses before it stops, and an event stream only
    ends when its listener leaves: without ending them, Install and restart would
    wait for ever on the tab's own stream. Run in a process of its own, as the app
    runs, and with the stream held open the way a tab holds it."""
    env = {**os.environ, "AZIMUT_HOME": str(tmp_path), "PYTHONPATH": str(Path(selfupdate.__file__).parents[2])}
    done = subprocess.run(
        [sys.executable, "-c", STOP_PROBE, ending], capture_output=True, text=True, timeout=90, env=env
    )
    assert done.stdout.strip().splitlines()[-1:] == [expected], done.stderr[-2000:]
