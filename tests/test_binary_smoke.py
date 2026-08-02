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
    }
    seen = []

    def request(url):
        path = url.removeprefix("http://127.0.0.1:8477")
        seen.append(path)
        return responses[path]

    monkeypatch.setattr(smoke_binary, "_request", request)
    smoke_binary.check_application("http://127.0.0.1:8477")

    assert seen == ["/api/health", "/", "/api/settings/ffmpeg"]


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
