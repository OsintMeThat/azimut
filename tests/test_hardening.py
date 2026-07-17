"""Local hardening: the decompression-bomb clamp and owner-only secrets file."""

import os
import stat
import sys

import pytest
from PIL import Image

from azimut import config


def test_decompression_bomb_guard_is_set():
    import azimut  # noqa: F401  (importing the package installs the clamp)

    assert Image.MAX_IMAGE_PIXELS == 100_000_000


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX file modes")
def test_settings_and_workspace_are_owner_only(tmp_workspace):
    config.ensure_workspace()
    assert stat.S_IMODE(os.stat(config.workspace_root()).st_mode) == 0o700
    assert stat.S_IMODE(os.stat(config.settings_path()).st_mode) == 0o600
