"""Local hardening: the decompression-bomb clamp and owner-only secrets file."""

import os
import stat
import sys
import warnings

import pytest
from PIL import Image

from azimut import config


def test_decompression_bomb_guard_is_set():
    import importlib

    import azimut

    # Pytest resets warning filters after package import. Reloading reproduces
    # normal process startup and proves the package installs its policy.
    importlib.reload(azimut)

    assert Image.MAX_IMAGE_PIXELS == 100_000_000
    assert any(
        action == "error" and category is Image.DecompressionBombWarning
        for action, _message, category, _module, _line in warnings.filters
    )


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX file modes")
def test_settings_and_workspace_are_owner_only(tmp_workspace):
    config.ensure_workspace()
    assert stat.S_IMODE(os.stat(config.workspace_root()).st_mode) == 0o700
    assert stat.S_IMODE(os.stat(config.internal_dir()).st_mode) == 0o700
    assert stat.S_IMODE(os.stat(config.settings_dir()).st_mode) == 0o700
    assert stat.S_IMODE(os.stat(config.settings_path()).st_mode) == 0o600
