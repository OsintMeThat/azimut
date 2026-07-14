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
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DEFAULT_SETTINGS: dict[str, Any] = {
    # Extra XYZ tile providers added by the user (spec §6 v1 notes).
    # Each: {"id", "label", "url" ({x}/{y}/{z} template), "attribution", "max_zoom"}
    "tile_providers": [],
    # Optional user-supplied API keys, keyed by provider id. Never required.
    # Built-in keyed providers (Mapbox, Google) read their token from here:
    # "mapbox": "pk....", "google": "AIza...".
    "api_keys": {},
    # Per-provider monthly tile-request counters: {"<provider_id>": {"YYYY-MM": count}}.
    # Local bookkeeping only, for billed keyed providers (Mapbox, Google).
    "usage": {},
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


def month_key(when: datetime | None = None) -> str:
    """The usage-counter bucket for a moment in time: "YYYY-MM" (UTC)."""
    return (when or datetime.now(timezone.utc)).strftime("%Y-%m")


_usage_lock = threading.Lock()  # tile proxy bumps the counter from many threads


def record_usage(meter: str, count: int = 1, when: datetime | None = None) -> int:
    """Bump a provider's tile counter for the month; returns the new total.

    Local bookkeeping only (docs/KEYED_PROVIDERS.md §6): billed keyed providers
    (Mapbox, Google) get a per-month tally so the user can watch their quota.
    No telemetry — the counter never leaves settings.json.
    """
    with _usage_lock:
        settings = load_settings()
        per_month = settings.setdefault("usage", {}).setdefault(meter, {})
        bucket = month_key(when)
        per_month[bucket] = int(per_month.get(bucket, 0)) + int(count)
        save_settings(settings)
        return per_month[bucket]
