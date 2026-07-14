"""Settings persistence and back-compat merging (spec: docs/KEYED_PROVIDERS.md §1)."""

import json

from azimut import config


def test_default_settings_has_usage_and_api_keys():
    assert config.DEFAULT_SETTINGS["usage"] == {}
    assert config.DEFAULT_SETTINGS["api_keys"] == {}


def test_ensure_workspace_writes_defaults(monkeypatch, tmp_path):
    monkeypatch.setenv("AZIMUT_HOME", str(tmp_path))
    config.ensure_workspace()
    saved = json.loads(config.settings_path().read_text(encoding="utf-8"))
    assert saved["usage"] == {}
    assert saved["tile_providers"] == []


def test_load_settings_roundtrips_usage_counters(monkeypatch, tmp_path):
    monkeypatch.setenv("AZIMUT_HOME", str(tmp_path))
    config.save_settings(
        {
            "tile_providers": [],
            "api_keys": {"mapbox": "pk.test"},
            "usage": {"mapbox": {"2026-07": 87}},
        }
    )
    loaded = config.load_settings()
    assert loaded["usage"] == {"mapbox": {"2026-07": 87}}
    assert loaded["api_keys"] == {"mapbox": "pk.test"}


def test_load_settings_back_compat_missing_usage_key(monkeypatch, tmp_path):
    """A settings.json written before `usage` existed still loads cleanly."""
    monkeypatch.setenv("AZIMUT_HOME", str(tmp_path))
    config.settings_path().parent.mkdir(parents=True, exist_ok=True)
    config.settings_path().write_text(
        json.dumps({"tile_providers": [], "api_keys": {"google": "AIza.test"}}),
        encoding="utf-8",
    )
    loaded = config.load_settings()
    assert loaded["usage"] == {}
    assert loaded["api_keys"] == {"google": "AIza.test"}


def test_load_settings_missing_file_returns_defaults(monkeypatch, tmp_path):
    monkeypatch.setenv("AZIMUT_HOME", str(tmp_path))
    loaded = config.load_settings()
    assert loaded == config.DEFAULT_SETTINGS
    assert loaded is not config.DEFAULT_SETTINGS
