from __future__ import annotations

import importlib.util
import os
import threading
from pathlib import Path

import pytest


SCRIPT = Path(__file__).parents[1] / "scripts" / "relaunch.py"
SPEC = importlib.util.spec_from_file_location("azimut_relaunch", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
relaunch = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(relaunch)


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
