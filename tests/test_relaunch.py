from __future__ import annotations

import contextlib
import importlib.util
import os
import socket
import threading
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest


SCRIPT = Path(__file__).parents[1] / "scripts" / "relaunch.py"
SPEC = importlib.util.spec_from_file_location("azimut_relaunch", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
relaunch = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(relaunch)


@contextlib.contextmanager
def monkeypatched(module: Any, **replacements: Callable[..., Any]) -> Iterator[None]:
    originals = {name: getattr(module, name) for name in replacements}
    for name, replacement in replacements.items():
        setattr(module, name, replacement)
    try:
        yield
    finally:
        for name, original in originals.items():
            setattr(module, name, original)


def _never_called(*_args: Any, **_kwargs: Any) -> Any:
    raise AssertionError("this helper should not have been called")


def test_control_socket_stops_only_the_matching_launcher(tmp_path: Path):
    state_path = tmp_path / "state.json"
    control = relaunch._ControlServer(state_path)
    control.start()

    def close_after_request() -> None:
        assert control.stop_requested.wait(timeout=2)
        control.close()

    closer = threading.Thread(target=close_after_request)
    closer.start()
    assert relaunch._stop_previous(state_path, timeout=2) is True
    closer.join(timeout=2)

    assert not closer.is_alive()
    assert not state_path.exists()


def test_stale_state_is_removed_without_stopping_a_process(tmp_path: Path):
    state_path = tmp_path / "state.json"
    state_path.write_text('{"port": 1, "token": "' + "a" * 64 + '"}', encoding="utf-8")

    assert relaunch._stop_previous(state_path, timeout=0.1) is False
    assert not state_path.exists()


@pytest.mark.parametrize(("platform", "reuses"), [("posix", True), ("nt", False)])
def test_probe_matches_the_way_the_server_binds(platform: str, reuses: bool):
    assert relaunch._probe_reuses_address(platform) is reuses


@pytest.mark.skipif(os.name == "nt", reason="POSIX-only TIME-WAIT semantics")
def test_a_closed_server_leaves_the_port_free_despite_time_wait():
    server = socket.socket()
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("127.0.0.1", 0))
    server.listen(1)
    port = server.getsockname()[1]
    client = socket.socket()
    client.connect(("127.0.0.1", port))
    accepted, _ = server.accept()
    # Closing the server side first parks the connection in TIME-WAIT, which
    # refuses a plain bind for minutes after the process is gone.
    accepted.close()
    server.close()
    client.close()

    assert relaunch._port_is_free(port) is True
    with monkeypatched(relaunch, _listener_pids=_never_called):
        assert relaunch._free_port(port, timeout=2) == []


def test_free_port_stops_the_process_holding_the_port():
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", 0))
    listener.listen(1)
    port = listener.getsockname()[1]
    assert relaunch._port_is_free(port) is False

    fake_pid = 4242
    killed: list[tuple[int, bool]] = []

    def kill(pid: int, *, force: bool) -> None:
        killed.append((pid, force))
        listener.close()

    with monkeypatched(relaunch, _listener_pids=lambda _port: {fake_pid}, _kill_pid=kill):
        assert relaunch._free_port(port, timeout=2) == [fake_pid]

    assert killed == [(fake_pid, False)]
    assert relaunch._port_is_free(port) is True


def test_free_port_is_a_no_op_when_nothing_listens():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]

    with monkeypatched(relaunch, _listener_pids=_never_called):
        assert relaunch._free_port(port, timeout=2) == []


def test_free_port_reports_an_unidentifiable_owner():
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", 0))
    listener.listen(1)
    port = listener.getsockname()[1]

    try:
        with monkeypatched(relaunch, _listener_pids=lambda _port: set()):
            with pytest.raises(RuntimeError, match="could not be identified"):
                relaunch._free_port(port, timeout=0.5)
    finally:
        listener.close()


def test_listener_pids_parses_windows_netstat(monkeypatch: pytest.MonkeyPatch):
    output = (
        "\r\nActive Connections\r\n\r\n"
        "  Proto  Local Address          Foreign Address        State           PID\r\n"
        "  TCP    127.0.0.1:8477         0.0.0.0:0              LISTENING       1234\r\n"
        "  TCP    127.0.0.1:8477         127.0.0.1:5500         ESTABLISHED     9999\r\n"
        "  TCP    0.0.0.0:445            0.0.0.0:0              LISTENING       4\r\n"
    )
    monkeypatch.setattr(relaunch, "_command_output", lambda _command: output)

    assert relaunch._listener_pids(8477, "nt") == {1234}


def test_listener_pids_falls_back_from_lsof_to_ss(monkeypatch: pytest.MonkeyPatch):
    ss_output = (
        "LISTEN 0 2048 127.0.0.1:8477 0.0.0.0:* "
        'users:(("python3",pid=7311,fd=9))\n'
        "LISTEN 0 4096 0.0.0.0:22 0.0.0.0:* "
        'users:(("sshd",pid=812,fd=3))\n'
    )
    outputs = {"lsof": "", "ss": ss_output}
    monkeypatch.setattr(
        relaunch, "_command_output", lambda command: outputs[command[0]]
    )

    assert relaunch._listener_pids(8477, "posix") == {7311}


@pytest.mark.parametrize(
    ("platform", "relative"),
    [("posix", Path(".venv/bin/python")), ("nt", Path(".venv/Scripts/python.exe"))],
)
def test_virtualenv_python_is_platform_specific(
    tmp_path: Path, platform: str, relative: Path
):
    python = tmp_path / relative
    python.parent.mkdir(parents=True)
    python.touch()

    assert relaunch._venv_python(tmp_path, platform) == python


def test_missing_virtualenv_has_an_actionable_error(tmp_path: Path):
    with pytest.raises(RuntimeError, match="create .venv first"):
        relaunch._venv_python(tmp_path, "posix")


def test_windows_npm_wrapper_uses_cmd(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(relaunch.shutil, "which", lambda _name: r"C:\Tools\npm.cmd")
    monkeypatch.setenv("COMSPEC", r"C:\Windows\System32\cmd.exe")

    assert relaunch._npm_build_command("nt") == [
        os.environ["COMSPEC"],
        "/d",
        "/s",
        "/c",
        r"C:\Tools\npm.cmd",
        "run",
        "build",
    ]
