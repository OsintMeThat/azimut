"""Showing a folder in the system file manager (engine/reveal.py + its routes).

The spawn is always faked: a real `xdg-open` in CI would either fail or, worse,
succeed and open a window on someone's desktop.
"""

import subprocess
import sys

import pytest

from azimut import config
from azimut.engine import reveal


@pytest.fixture
def spawns(monkeypatch):
    """Record what would have been launched, launching nothing.

    A graphical session is faked too, so the Linux tests behave the same whether
    CI runs them headless or a developer runs them on a desktop.
    """
    calls = []

    class FakePopen:
        def __init__(self, argv, **kwargs):
            calls.append({"argv": argv, "kwargs": kwargs})

    monkeypatch.setattr(reveal.subprocess, "Popen", FakePopen)
    monkeypatch.setattr(reveal.os, "startfile", lambda path: calls.append({"startfile": path}),
                        raising=False)
    monkeypatch.setenv("DISPLAY", ":0")
    return calls


def _workspace_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("AZIMUT_HOME", str(tmp_path))
    (tmp_path / "cases" / "demo").mkdir(parents=True)
    return tmp_path / "cases" / "demo"


def test_linux_hands_the_folder_to_xdg_open(tmp_path, monkeypatch, spawns):
    folder = _workspace_dir(tmp_path, monkeypatch)
    monkeypatch.setattr(sys, "platform", "linux")

    reveal.reveal(folder)

    assert spawns[0]["argv"] == ["xdg-open", str(folder.resolve())]


def test_macos_uses_open(tmp_path, monkeypatch, spawns):
    folder = _workspace_dir(tmp_path, monkeypatch)
    monkeypatch.setattr(sys, "platform", "darwin")

    reveal.reveal(folder)

    assert spawns[0]["argv"] == ["open", str(folder.resolve())]


def test_windows_goes_through_the_stdlib_shell_open(tmp_path, monkeypatch, spawns):
    """os.startfile rather than an argv: nothing to quote, so nothing to inject."""
    folder = _workspace_dir(tmp_path, monkeypatch)
    monkeypatch.setattr(sys, "platform", "win32")

    reveal.reveal(folder)

    assert spawns[0]["startfile"] == folder.resolve()


def test_never_runs_through_a_shell_and_never_waits(tmp_path, monkeypatch, spawns):
    """A file manager outlives the request, and a shell would take the path apart."""
    folder = _workspace_dir(tmp_path, monkeypatch)
    monkeypatch.setattr(sys, "platform", "linux")

    reveal.reveal(folder)

    kwargs = spawns[0]["kwargs"]
    assert "shell" not in kwargs
    assert kwargs["start_new_session"] is True
    assert kwargs["stdout"] is subprocess.DEVNULL and kwargs["stderr"] is subprocess.DEVNULL


def test_a_folder_name_with_spaces_stays_one_argument(tmp_path, monkeypatch, spawns):
    monkeypatch.setenv("AZIMUT_HOME", str(tmp_path))
    folder = tmp_path / "cases" / "Convoy dashcam & co"
    folder.mkdir(parents=True)
    monkeypatch.setattr(sys, "platform", "linux")

    reveal.reveal(folder)

    assert spawns[0]["argv"][1] == str(folder.resolve())


def test_refuses_a_folder_outside_the_workspace(tmp_path, monkeypatch, spawns):
    monkeypatch.setenv("AZIMUT_HOME", str(tmp_path / "home"))
    (tmp_path / "home").mkdir()
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()

    with pytest.raises(reveal.RevealError, match="outside the workspace"):
        reveal.reveal(elsewhere)
    assert not spawns


def test_refuses_to_climb_out_with_dot_dot(tmp_path, monkeypatch, spawns):
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("AZIMUT_HOME", str(home))

    with pytest.raises(reveal.RevealError, match="outside the workspace"):
        reveal.reveal(home / ".." / "somewhere-else")
    assert not spawns


def test_reports_a_folder_that_has_gone(tmp_path, monkeypatch, spawns):
    monkeypatch.setenv("AZIMUT_HOME", str(tmp_path))

    with pytest.raises(reveal.RevealError, match="no longer exists"):
        reveal.reveal(tmp_path / "cases" / "deleted-by-hand")
    assert not spawns


def test_names_the_missing_opener_when_xdg_utils_is_absent(tmp_path, monkeypatch, spawns):
    folder = _workspace_dir(tmp_path, monkeypatch)
    monkeypatch.setattr(sys, "platform", "linux")

    def no_opener(*_args, **_kwargs):
        raise FileNotFoundError("xdg-open")

    monkeypatch.setattr(reveal.subprocess, "Popen", no_opener)

    with pytest.raises(reveal.RevealError, match="xdg-open is missing"):
        reveal.reveal(folder)


def test_refuses_on_a_linux_box_with_no_graphical_session(tmp_path, monkeypatch, spawns):
    """Over SSH or as a service, xdg-open exits without opening anything.

    Silenced stderr plus a detached process means we'd never hear about it, so the
    UI would report a window that never appeared. Better to say so up front.
    """
    folder = _workspace_dir(tmp_path, monkeypatch)
    monkeypatch.setattr(sys, "platform", "linux")
    monkeypatch.delenv("DISPLAY", raising=False)
    monkeypatch.delenv("WAYLAND_DISPLAY", raising=False)

    with pytest.raises(reveal.RevealError, match="no desktop session"):
        reveal.reveal(folder)
    assert not spawns


def test_wayland_alone_counts_as_a_session(tmp_path, monkeypatch, spawns):
    folder = _workspace_dir(tmp_path, monkeypatch)
    monkeypatch.setattr(sys, "platform", "linux")
    monkeypatch.delenv("DISPLAY", raising=False)
    monkeypatch.setenv("WAYLAND_DISPLAY", "wayland-0")

    reveal.reveal(folder)

    assert spawns[0]["argv"][0] == "xdg-open"


def test_macos_never_asks_about_a_display(tmp_path, monkeypatch, spawns):
    """A Mac always has a Finder, and it exports no DISPLAY."""
    folder = _workspace_dir(tmp_path, monkeypatch)
    monkeypatch.setattr(sys, "platform", "darwin")
    monkeypatch.delenv("DISPLAY", raising=False)
    monkeypatch.delenv("WAYLAND_DISPLAY", raising=False)

    reveal.reveal(folder)

    assert spawns[0]["argv"][0] == "open"


def test_windows_never_asks_about_a_display(tmp_path, monkeypatch, spawns):
    folder = _workspace_dir(tmp_path, monkeypatch)
    monkeypatch.setattr(sys, "platform", "win32")
    monkeypatch.delenv("DISPLAY", raising=False)
    monkeypatch.delenv("WAYLAND_DISPLAY", raising=False)

    reveal.reveal(folder)

    assert spawns[0]["startfile"] == folder.resolve()


def test_windows_refusal_becomes_a_reason_not_a_traceback(tmp_path, monkeypatch, spawns):
    folder = _workspace_dir(tmp_path, monkeypatch)
    monkeypatch.setattr(sys, "platform", "win32")

    def refuse(_path):
        raise OSError("[WinError 1155] No application is associated")

    monkeypatch.setattr(reveal.os, "startfile", refuse, raising=False)

    with pytest.raises(reveal.RevealError, match="Windows could not open"):
        reveal.reveal(folder)


# -- the routes --------------------------------------------------------------


@pytest.fixture
def shown(monkeypatch):
    """What the routes asked to reveal, without revealing it."""
    seen = []
    monkeypatch.setattr(reveal, "reveal", lambda path: seen.append(path))
    return seen


def test_case_route_reveals_that_case_and_nothing_else(client, shown):
    cid = client.post("/api/cases", json={"name": "Reveal"}).json()["id"]

    res = client.post(f"/api/cases/{cid}/reveal")

    assert res.status_code == 200
    assert res.json()["path"].endswith(cid)
    assert shown == [config.cases_dir() / cid]


def test_case_route_takes_no_path_from_the_caller(client, shown):
    """The id is the whole input, and it has to resolve to a case that exists.

    A caller cannot name a folder, only a case, so there is no path to traverse
    out of. Anything that isn't a case is turned away before the file manager is
    reached; the containment check itself is covered against the engine above.
    """
    for attempt in ("no-such-case", "..", "....", "etc"):
        res = client.post(f"/api/cases/{attempt}/reveal")
        assert res.status_code != 200, attempt
    assert not shown


def test_workspace_route_reveals_the_root(client, shown):
    res = client.post("/api/settings/reveal-workspace")

    assert res.status_code == 200
    assert res.json()["path"] == str(config.workspace_root())
    assert shown == [config.workspace_root()]


def test_a_refusal_reaches_the_ui_as_a_reason(client, monkeypatch):
    def refuse(_path):
        raise reveal.RevealError("no file manager found (xdg-open is missing)")

    monkeypatch.setattr(reveal, "reveal", refuse)

    res = client.post("/api/settings/reveal-workspace")

    assert res.status_code == 409
    assert "xdg-open" in res.json()["detail"]
