"""The dev tool that loads the capture extension into a browser.

Nothing here starts a browser: what is worth pinning is the part written by
hand, which is the token lookup, the hand-rolled WebSocket framing and the
choices about where each profile lives.
"""

from __future__ import annotations

import importlib.util
import json
import os
import socket
import sys
import struct
import urllib.error
from pathlib import Path
from typing import Any

import pytest


SCRIPT = Path(__file__).parents[1] / "scripts" / "devext.py"
SPEC = importlib.util.spec_from_file_location("azimut_devext", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
devext = importlib.util.module_from_spec(SPEC)
# Registered before it runs: its dataclass looks itself up in sys.modules.
sys.modules[SPEC.name] = devext
SPEC.loader.exec_module(devext)


class FakeResponse:
    def __init__(self, payload: dict[str, Any]) -> None:
        self._payload = json.dumps(payload).encode()

    def read(self) -> bytes:
        return self._payload

    def __enter__(self) -> FakeResponse:
        return self

    def __exit__(self, *_exc: object) -> None:
        return None


def _settings_file(root: Path, payload: dict[str, Any]) -> None:
    settings = root / ".azimut" / "settings"
    settings.mkdir(parents=True)
    (settings / "settings.json").write_text(json.dumps(payload), encoding="utf-8")


def test_token_comes_from_the_running_app(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    asked: list[str] = []

    def urlopen(request: Any, timeout: float = 0) -> FakeResponse:
        asked.append(request.full_url)
        assert request.get_method() == "POST"
        return FakeResponse({"ingest_token": "from-the-app"})

    _settings_file(tmp_path, {"ingest_token": "from-the-file"})
    monkeypatch.setenv("AZIMUT_HOME", str(tmp_path))
    monkeypatch.setattr(devext.urllib.request, "urlopen", urlopen)

    assert devext.pairing_token("http://127.0.0.1:8477") == "from-the-app"
    assert asked == ["http://127.0.0.1:8477/api/settings/ingest-token"]


def test_token_falls_back_to_settings_when_the_app_is_down(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    def urlopen(*_args: Any, **_kwargs: Any) -> FakeResponse:
        raise urllib.error.URLError("nothing listening")

    _settings_file(tmp_path, {"ingest_token": "from-the-file"})
    monkeypatch.setenv("AZIMUT_HOME", str(tmp_path))
    monkeypatch.setattr(devext.urllib.request, "urlopen", urlopen)

    assert devext.pairing_token("http://127.0.0.1:8477") == "from-the-file"


def test_no_token_anywhere_is_reported_as_none(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    def urlopen(*_args: Any, **_kwargs: Any) -> FakeResponse:
        raise urllib.error.URLError("nothing listening")

    monkeypatch.setenv("AZIMUT_HOME", str(tmp_path))
    monkeypatch.setattr(devext.urllib.request, "urlopen", urlopen)

    assert devext.pairing_token("http://127.0.0.1:8477") is None


class FakeSocket:
    """A socket whose reads are scripted and whose writes are kept."""

    def __init__(self, incoming: bytes = b"") -> None:
        self.incoming = incoming
        self.sent = bytearray()

    def recv(self, size: int) -> bytes:
        chunk, self.incoming = self.incoming[:size], self.incoming[size:]
        return chunk

    def sendall(self, data: bytes) -> None:
        self.sent += data

    def close(self) -> None:
        return None


def _websocket(incoming: bytes = b"") -> Any:
    ws = devext.WebSocket.__new__(devext.WebSocket)  # no handshake, no network
    ws.sock = FakeSocket(incoming)
    ws.buf = b""
    return ws


def _server_frame(payload: bytes, opcode: int = 0x1) -> bytes:
    """A frame as a server sends it: final, unmasked, shortest length form."""
    header = bytearray([0x80 | opcode])
    if len(payload) < 126:
        header.append(len(payload))
    elif len(payload) < 1 << 16:
        header += bytes([126]) + struct.pack(">H", len(payload))
    else:
        header += bytes([127]) + struct.pack(">Q", len(payload))
    return bytes(header) + payload


def test_frames_it_sends_are_masked_text():
    ws = _websocket()
    ws.send("hi")

    sent = bytes(ws.sock.sent)
    assert sent[0] == 0x81  # final frame, text
    assert sent[1] == 0x80 | 2  # masked, two bytes
    mask, masked = sent[2:6], sent[6:]
    assert bytes(b ^ mask[i % 4] for i, b in enumerate(masked)) == b"hi"


@pytest.mark.parametrize("size", [4, 200, 70000])
def test_it_reads_back_frames_of_every_length_form(size: int):
    payload = ("x" * size).encode()
    ws = _websocket(_server_frame(payload))

    assert ws.recv() == payload.decode()


def test_a_ping_is_answered_and_the_next_frame_still_arrives():
    ws = _websocket(_server_frame(b"", opcode=0x9) + _server_frame(b'{"id":1}'))

    assert ws.recv() == '{"id":1}'
    assert bytes(ws.sock.sent)[:2] == b"\x8a\x80"  # a masked, empty pong


def test_a_closed_connection_is_an_error_not_a_hang():
    ws = _websocket(b"")

    with pytest.raises(RuntimeError):
        ws.recv()


def test_the_browser_can_be_pointed_at_by_hand(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("AZIMUT_CHROME", "/somewhere/chrome")
    monkeypatch.setattr(devext.shutil, "which", lambda _name: "/usr/bin/google-chrome")

    assert devext.find_binary("AZIMUT_CHROME", devext.CHROME_NAMES, "chrome") == (
        "/somewhere/chrome"
    )


def test_without_an_override_the_first_browser_on_path_wins(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("AZIMUT_CHROME", raising=False)
    monkeypatch.setattr(
        devext.shutil,
        "which",
        lambda name: "/usr/bin/chromium" if name == "chromium" else None,
    )

    assert devext.find_binary("AZIMUT_CHROME", devext.CHROME_NAMES, "chrome") == (
        "/usr/bin/chromium"
    )


def test_a_missing_browser_is_reported_rather_than_guessed(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("AZIMUT_FIREFOX", raising=False)
    monkeypatch.setattr(devext.shutil, "which", lambda _name: None)
    monkeypatch.setitem(devext.MAC_APPS, "firefox", "/nowhere/firefox")

    assert devext.find_binary("AZIMUT_FIREFOX", devext.FIREFOX_NAMES, "firefox") is None


def test_the_snap_firefox_keeps_its_profile_where_it_can_read_it(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    """A snap sees only part of $HOME; its own writable area always works."""
    monkeypatch.setattr(devext.Path, "home", classmethod(lambda _cls: tmp_path))
    (tmp_path / "snap" / "firefox" / "common").mkdir(parents=True)

    assert devext.firefox_profile_dir() == tmp_path / "snap/firefox/common/azimut-devext"


def test_without_a_snap_the_profile_sits_with_the_other_dev_state(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    monkeypatch.setattr(devext.Path, "home", classmethod(lambda _cls: tmp_path))
    monkeypatch.setattr(devext, "STATE", tmp_path / ".cache" / "azimut-devext")

    assert devext.firefox_profile_dir() == tmp_path / ".cache/azimut-devext/firefox"


def test_a_saved_file_changes_the_fingerprint(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    (tmp_path / "background.js").write_text("one", encoding="utf-8")
    monkeypatch.setattr(devext, "EXT", tmp_path)
    before = devext.fingerprint()

    (tmp_path / "background.js").write_text("two", encoding="utf-8")
    os.utime(tmp_path / "background.js", (0, 1))

    assert devext.fingerprint() != before


def test_a_browser_that_never_answers_is_given_up_on():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        free_port = probe.getsockname()[1]

    assert devext.wait_for_port(free_port, timeout=0.5) is False


def test_a_fresh_background_is_the_proof_the_reload_landed(capsys: pytest.CaptureFixture[str]):
    devext.report_background("chrome", json.dumps(["0.3.0", 640]))

    assert "restarted 0.6s ago, running v0.3.0" in capsys.readouterr().out


def test_an_old_background_is_called_out_rather_than_celebrated(
    capsys: pytest.CaptureFixture[str],
):
    devext.report_background("firefox", json.dumps(["0.3.0", 90_000]))

    assert "kept the code it had" in capsys.readouterr().out


def test_a_sleeping_background_says_so(capsys: pytest.CaptureFixture[str]):
    devext.report_background("chrome", None)

    assert "background asleep" in capsys.readouterr().out
