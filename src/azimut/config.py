"""Application configuration and workspace-root resolution.

Everything Azimut persists lives under one root directory (default ``~/Azimut``,
overridable with the ``AZIMUT_HOME`` environment variable):

    ~/Azimut/
    ├── cases/       # named investigations
    ├── scratch/     # one-shot sessions (promotable to cases)
    └── settings.json

No database server — plain files only (spec §4).
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

DEFAULT_SETTINGS: dict[str, Any] = {
    # Extra XYZ tile providers added by the user (spec §6 v1 notes).
    # Each: {"id", "label", "url" ({x}/{y}/{z} template), "attribution", "max_zoom"}
    "tile_providers": [],
    # Optional user-supplied API keys, keyed by provider id. Never required.
    "api_keys": {},
}


def workspace_root() -> Path:
    root = Path(os.environ.get("AZIMUT_HOME", "~/Azimut")).expanduser()
    return root


def cases_dir() -> Path:
    return workspace_root() / "cases"


def scratch_dir() -> Path:
    return workspace_root() / "scratch"


def settings_path() -> Path:
    return workspace_root() / "settings.json"


def ensure_workspace() -> None:
    """Create the workspace skeleton if missing (idempotent)."""
    cases_dir().mkdir(parents=True, exist_ok=True)
    scratch_dir().mkdir(parents=True, exist_ok=True)
    if not settings_path().exists():
        save_settings(DEFAULT_SETTINGS)


def load_settings() -> dict[str, Any]:
    try:
        data = json.loads(settings_path().read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return dict(DEFAULT_SETTINGS)
    merged = dict(DEFAULT_SETTINGS)
    merged.update(data)
    return merged


def save_settings(settings: dict[str, Any]) -> None:
    settings_path().parent.mkdir(parents=True, exist_ok=True)
    settings_path().write_text(
        json.dumps(settings, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
