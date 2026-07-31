"""Where Azimut looks for its workspace, and what happens when it isn't there.

The pointer is the one piece of state that cannot live inside the workspace, so
it is also the only thing that can tell a moved folder from a lost one. These
tests pin the resolution order, the platform locations, and the rule that a
configured folder is never silently recreated.

Every test here runs the same on Windows, macOS and Linux: the platform-specific
paths are exercised by faking ``sys.platform`` rather than by skipping.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from azimut import config

#: Captured at import, before the suite-wide fixture redirects them into
#: temporary directories. The platform test below needs the real pointer
#: location, and the default root is the one literal path this file still has to
#: pin: every other test compares against `config.DEFAULT_ROOT`, which the
#: fixture moves so that no test can open the developer's own workspace.
REAL_POINTER_DIR = config._pointer_dir
REAL_DEFAULT_ROOT = config.DEFAULT_ROOT


@pytest.fixture(autouse=True)
def no_environment_override(monkeypatch):
    """These tests are about the pointer, so the env var must be out of the way."""
    monkeypatch.delenv("AZIMUT_HOME", raising=False)
    config.forget_workspace_root()


def test_the_default_root_is_the_home_folder_azimut_names():
    assert REAL_DEFAULT_ROOT == Path("~/Azimut")


def test_the_default_root_is_used_when_nothing_says_otherwise():
    assert config.workspace_root() == config.DEFAULT_ROOT.expanduser()


def test_the_pointer_moves_the_workspace(tmp_path):
    config.write_pointer(tmp_path / "elsewhere")

    assert config.workspace_root() == tmp_path / "elsewhere"
    assert config.internal_dir() == tmp_path / "elsewhere" / ".azimut"


def test_the_environment_wins_over_the_pointer(monkeypatch, tmp_path):
    """A USB stick or a second profile is an instruction given on every launch;
    it must not need the machine's configuration rewritten to work."""
    config.write_pointer(tmp_path / "pointed")
    monkeypatch.setenv("AZIMUT_HOME", str(tmp_path / "portable"))

    assert config.workspace_root() == tmp_path / "portable"


def test_clearing_the_pointer_returns_to_the_default_root(tmp_path):
    config.write_pointer(tmp_path / "elsewhere")
    assert config.workspace_root() == tmp_path / "elsewhere"

    config.clear_pointer()

    assert config.workspace_root() == config.DEFAULT_ROOT.expanduser()


def test_a_lost_pointer_costs_an_address_and_nothing_else(tmp_path):
    """Unreadable, empty and absent are one case on purpose: fall back, don't fail."""
    config.write_pointer(tmp_path / "elsewhere")
    config.pointer_path().write_text("   \n", encoding="utf-8")
    config.forget_workspace_root()

    assert config.workspace_root() == config.DEFAULT_ROOT.expanduser()


def test_an_unreadable_pointer_falls_back_too():
    """A directory in the pointer's place is the portable way to be unreadable:
    POSIX raises IsADirectoryError, Windows raises PermissionError, and Azimut
    treats both the same as no pointer at all."""
    config.pointer_path().mkdir(parents=True, exist_ok=True)
    config.forget_workspace_root()

    assert config.workspace_root() == config.DEFAULT_ROOT.expanduser()


def test_the_pointer_is_one_line_of_plain_text(tmp_path):
    """Small enough that a human can read it, and fix it, with any editor."""
    config.write_pointer(tmp_path / "elsewhere")

    written = config.pointer_path().read_text(encoding="utf-8")

    assert written.splitlines() == [str(tmp_path / "elsewhere")]


def test_writing_the_pointer_replaces_it_atomically(tmp_path):
    config.write_pointer(tmp_path / "first")
    config.write_pointer(tmp_path / "second")

    assert config.read_pointer() == tmp_path / "second"
    leftovers = [p.name for p in config.pointer_path().parent.iterdir() if p.name.endswith(".tmp")]
    assert leftovers == []


def test_a_home_relative_pointer_is_expanded(tmp_path):
    config.pointer_path().parent.mkdir(parents=True, exist_ok=True)
    config.pointer_path().write_text("~/Somewhere\n", encoding="utf-8")
    config.forget_workspace_root()

    assert config.workspace_root() == Path("~/Somewhere").expanduser()


# -- the platform locations ---------------------------------------------------


def test_the_pointer_sits_where_each_platform_keeps_configuration(monkeypatch, tmp_path):
    """One file per platform convention, never beside the program: a frozen
    binary can live somewhere read-only."""
    monkeypatch.setattr(config, "_pointer_dir", REAL_POINTER_DIR)

    monkeypatch.setattr("sys.platform", "win32")
    monkeypatch.setenv("APPDATA", str(tmp_path / "Roaming"))
    assert config.pointer_path() == tmp_path / "Roaming" / "Azimut" / "location"

    monkeypatch.setattr("sys.platform", "darwin")
    assert (
        config.pointer_path()
        == Path("~/Library/Application Support/Azimut").expanduser() / "location"
    )

    monkeypatch.setattr("sys.platform", "linux")
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "xdg"))
    assert config.pointer_path() == tmp_path / "xdg" / "azimut" / "location"


def test_linux_falls_back_to_dot_config_without_xdg(monkeypatch):
    monkeypatch.setattr(config, "_pointer_dir", REAL_POINTER_DIR)
    monkeypatch.setattr("sys.platform", "linux")
    monkeypatch.delenv("XDG_CONFIG_HOME", raising=False)

    assert config.pointer_path() == Path("~/.config").expanduser() / "azimut" / "location"


def test_windows_falls_back_to_the_roaming_profile_without_appdata(monkeypatch):
    monkeypatch.setattr(config, "_pointer_dir", REAL_POINTER_DIR)
    monkeypatch.setattr("sys.platform", "win32")
    monkeypatch.delenv("APPDATA", raising=False)

    assert config.pointer_path() == Path("~/AppData/Roaming/Azimut").expanduser() / "location"


# -- a configured folder that is gone -----------------------------------------


def test_a_configured_folder_that_is_gone_is_reported_missing(tmp_path):
    """Never silently recreated: that is how someone concludes they lost everything."""
    workspace = tmp_path / "on-a-drive"
    workspace.mkdir()
    config.write_pointer(workspace)
    assert not config.workspace_missing()

    workspace.rmdir()

    assert config.workspace_missing()


def test_a_first_run_is_not_a_missing_workspace(monkeypatch, tmp_path):
    """No pointer means nobody has configured anything, so there is nothing to lose."""
    assert not config.workspace_missing()

    monkeypatch.setenv("AZIMUT_HOME", str(tmp_path / "brand-new"))

    assert not config.workspace_missing()


def test_the_environment_settles_it_even_with_a_stale_pointer(monkeypatch, tmp_path):
    """A pointer left by an earlier run names a folder this run never uses. It
    must not be able to stop the app that was told where to look."""
    config.write_pointer(tmp_path / "long-gone")
    monkeypatch.setenv("AZIMUT_HOME", str(tmp_path))

    assert not config.workspace_missing()


def test_a_file_where_the_workspace_should_be_counts_as_missing(tmp_path):
    target = tmp_path / "not-a-folder"
    target.write_text("", encoding="utf-8")
    config.write_pointer(target)

    assert config.workspace_missing()
