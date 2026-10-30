"""Tests for the standalone-binary release smoke test."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest


SCRIPT = Path(__file__).parents[1] / "scripts" / "smoke_binary.py"
SPEC = importlib.util.spec_from_file_location("azimut_smoke_binary", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
smoke_binary = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(smoke_binary)


def test_check_application_exercises_health_frontend_and_bundled_ffmpeg(monkeypatch):
    responses = {
        "/api/health": (200, "application/json", json.dumps({"status": "ok"})),
        "/": (200, "text/html", '<html><div id="app"></div></html>'),
        "/api/settings/ffmpeg": (
            200,
            "application/json",
            json.dumps({"available": True, "source": "bundled"}),
        ),
        "/api/settings/ffmpeg/notice": (200, "text/plain", "SHA-256: abc\nGNU GENERAL PUBLIC LICENSE"),
        "/api/settings/bundled": (
            200,
            "application/json",
            json.dumps({"zones": True, "pdf_fonts": True, "extension": True}),
        ),
    }
    seen = []

    def request(url):
        path = url.removeprefix("http://127.0.0.1:8477")
        seen.append(path)
        return responses[path]

    monkeypatch.setattr(smoke_binary, "_request", request)
    smoke_binary.check_application("http://127.0.0.1:8477")

    assert seen == [
        "/api/health", "/", "/api/settings/ffmpeg", "/api/settings/ffmpeg/notice", "/api/settings/bundled",
    ]


@pytest.mark.parametrize(
    ("path", "answer", "says"),
    [
        ("/api/settings/ffmpeg/notice", (404, "application/json", "{}"), "licence notice"),
        (
            "/api/settings/bundled",
            (200, "application/json", json.dumps({"zones": False, "pdf_fonts": True, "extension": True})),
            "zones",
        ),
    ],
)
def test_check_application_rejects_a_binary_missing_a_silent_part(monkeypatch, path, answer, says):
    """A spec that forgets tzdata, the fonts, the extension or ffmpeg's notice still
    builds a binary that starts. Only asking for them catches it."""
    responses = {
        "/api/health": (200, "application/json", json.dumps({"status": "ok"})),
        "/": (200, "text/html", '<div id="app"></div>'),
        "/api/settings/ffmpeg": (200, "application/json", json.dumps({"available": True, "source": "bundled"})),
        "/api/settings/ffmpeg/notice": (200, "text/plain", "SHA-256: abc GNU"),
        "/api/settings/bundled": (200, "application/json", json.dumps({"zones": True, "pdf_fonts": True, "extension": True})),
    }
    responses[path] = answer
    monkeypatch.setattr(smoke_binary, "_request", lambda url: responses[url.removeprefix("http://127.0.0.1:8477")])

    with pytest.raises(RuntimeError, match=says):
        smoke_binary.check_application("http://127.0.0.1:8477")


def test_check_application_rejects_path_ffmpeg(monkeypatch):
    responses = iter(
        [
            (200, "application/json", json.dumps({"status": "ok"})),
            (200, "text/html", '<div id="app"></div>'),
            (
                200,
                "application/json",
                json.dumps({"available": True, "source": "path"}),
            ),
        ]
    )
    monkeypatch.setattr(smoke_binary, "_request", lambda _url: next(responses))

    with pytest.raises(RuntimeError, match="bundled ffmpeg"):
        smoke_binary.check_application("http://127.0.0.1:8477")


class FakeProcess:
    """Enough of Popen for stop(): it reports alive, then dies when asked."""

    def __init__(self, alive: bool = True):
        self.pid = 4242
        self._alive = alive
        self.terminated = False

    def poll(self):
        return None if self._alive else 0

    def terminate(self):
        self.terminated = True
        self._alive = False

    def kill(self):  # pragma: no cover - only a hung process reaches this
        self._alive = False

    def wait(self, timeout=None):
        self._alive = False
        return 0


def test_stop_kills_the_whole_tree_on_windows(monkeypatch):
    """The onefile bootloader's child holds the workspace lock open.

    Terminating the bootloader alone leaves it running, and Windows then refuses
    to delete the temporary workspace it is writing in.
    """
    monkeypatch.setattr(smoke_binary.sys, "platform", "win32")
    calls = []
    monkeypatch.setattr(
        smoke_binary.subprocess, "run", lambda cmd, **kw: calls.append(cmd)
    )
    process = FakeProcess()

    smoke_binary.stop(process)

    assert calls == [["taskkill", "/F", "/T", "/PID", "4242"]]
    assert not process.terminated


def test_stop_signals_the_bootloader_on_posix(monkeypatch):
    monkeypatch.setattr(smoke_binary.sys, "platform", "linux")
    monkeypatch.setattr(
        smoke_binary.subprocess,
        "run",
        lambda *a, **kw: pytest.fail("taskkill is Windows-only"),
    )
    process = FakeProcess()

    smoke_binary.stop(process)

    assert process.terminated


def test_stop_leaves_an_already_exited_process_alone(monkeypatch):
    monkeypatch.setattr(smoke_binary.sys, "platform", "win32")
    monkeypatch.setattr(
        smoke_binary.subprocess,
        "run",
        lambda *a, **kw: pytest.fail("nothing left to kill"),
    )

    smoke_binary.stop(FakeProcess(alive=False))


def test_check_gallery_dl_runs_the_binary_as_gallery_dl(monkeypatch):
    """The flag must reach gallery-dl's entry point, extractors bundled."""
    from types import SimpleNamespace

    calls = []

    def run(cmd, **kw):
        calls.append(cmd)
        if "--version" in cmd:
            return SimpleNamespace(returncode=0, stdout="1.32.6\n", stderr="")
        return SimpleNamespace(returncode=64, stdout="", stderr="Unsupported URL")

    monkeypatch.setattr(smoke_binary.subprocess, "run", run)
    smoke_binary.check_gallery_dl(Path("azimut"), {})
    assert [cmd[1] for cmd in calls] == ["--run-gallery-dl", "--run-gallery-dl"]


@pytest.mark.parametrize(
    ("version", "unknown", "said"),
    [
        # The binary ignored the flag and started the app, or crashed before gallery-dl.
        ((1, "", "Traceback"), (64, "", ""), "did not run as gallery-dl"),
        # gallery-dl ran, but without its extractors the address is not "unknown".
        ((0, "1.32.6\n", ""), (1, "", "ModuleNotFoundError"), "extractors are missing"),
    ],
)
def test_check_gallery_dl_fails_a_binary_that_is_not_gallery_dl(monkeypatch, version, unknown, said):
    from types import SimpleNamespace

    def run(cmd, **kw):
        code, out, err = version if "--version" in cmd else unknown
        return SimpleNamespace(returncode=code, stdout=out, stderr=err)

    monkeypatch.setattr(smoke_binary.subprocess, "run", run)
    with pytest.raises(RuntimeError, match=said):
        smoke_binary.check_gallery_dl(Path("azimut"), {})


def test_the_smoke_flag_is_the_one_the_app_starts_gallery_dl_with():
    from azimut.engine import gallerydl

    assert smoke_binary.GALLERY_DL_FLAG == gallerydl.FROZEN_FLAG


def test_check_processes_wants_the_pool_to_answer(monkeypatch):
    from types import SimpleNamespace

    calls = []

    def run(cmd, **kw):
        calls.append(cmd)
        return SimpleNamespace(returncode=0, stdout="840\n", stderr="")

    monkeypatch.setattr(smoke_binary.subprocess, "run", run)
    smoke_binary.check_processes(Path("azimut"), {})
    assert [cmd[1] for cmd in calls] == ["--smoke-processes"]


@pytest.mark.parametrize(
    "answer",
    [
        # the children started a second app, so nothing was summed
        (1, "", "OSError: address already in use"),
        # the parent ran, the pool did not
        (0, "", ""),
    ],
)
def test_check_processes_fails_a_binary_whose_children_do_not_work(monkeypatch, answer):
    from types import SimpleNamespace

    code, out, err = answer
    monkeypatch.setattr(smoke_binary.subprocess, "run", lambda cmd, **kw: SimpleNamespace(returncode=code, stdout=out, stderr=err))
    with pytest.raises(RuntimeError, match="processes did not answer"):
        smoke_binary.check_processes(Path("azimut"), {})


def test_a_pool_that_never_answers_fails_the_smoke(monkeypatch):
    import subprocess

    def run(cmd, **kw):
        raise subprocess.TimeoutExpired(cmd, kw.get("timeout"))

    monkeypatch.setattr(smoke_binary.subprocess, "run", run)
    with pytest.raises(RuntimeError, match="never answered"):
        smoke_binary.check_processes(Path("azimut"), {})


def test_the_entry_point_runs_the_pool_the_smoke_asks_for():
    """packaging/entry.py, run the way the binary is: the flag sums the children's answers."""
    import subprocess
    import sys

    entry = Path(__file__).parents[1] / "packaging" / "entry.py"
    done = subprocess.run([sys.executable, str(entry), smoke_binary.PROCESSES_FLAG],
                          capture_output=True, text=True, timeout=180, check=False)
    assert done.returncode == 0, done.stderr
    assert done.stdout.strip() == "840"
