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
