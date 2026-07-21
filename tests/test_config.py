"""Settings persistence and back-compat merging (spec: docs/IMAGERY_PROVIDERS.md)."""

import json

import pytest

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


def test_save_settings_is_atomic_when_replace_fails(monkeypatch, tmp_path):
    monkeypatch.setenv("AZIMUT_HOME", str(tmp_path))
    config.save_settings({**config.DEFAULT_SETTINGS, "units": "metric"})
    before = config.settings_path().read_bytes()

    def fail_replace(_source, _target):
        raise OSError("replace failed")

    monkeypatch.setattr(config.os, "replace", fail_replace)
    with pytest.raises(OSError, match="replace failed"):
        config.save_settings({**config.DEFAULT_SETTINGS, "units": "imperial"})

    assert config.settings_path().read_bytes() == before
    assert list(tmp_path.glob(".settings.json.*.tmp")) == []


@pytest.mark.parametrize(
    "content",
    ["[]", "{", '{"schema": 2, "proof": [], "post": []}', '{"schema": 1, "proof": [42], "post": []}'],
)
def test_load_templates_recovers_from_malformed_stores(monkeypatch, tmp_path, content):
    monkeypatch.setenv("AZIMUT_HOME", str(tmp_path))
    config.templates_path().write_text(content, encoding="utf-8")
    assert config.load_templates() == config.DEFAULT_TEMPLATES


def test_load_templates_filters_bad_records_and_duplicate_ids(monkeypatch, tmp_path):
    monkeypatch.setenv("AZIMUT_HOME", str(tmp_path))
    config.templates_path().write_text(
        json.dumps(
            {
                "schema": 1,
                "proof": [
                    {"id": "kept", "name": " First ", "data": {"bg": "#ffffff"}},
                    {"id": "kept", "name": "Duplicate", "data": {}},
                    {"id": "bad id", "name": "Bad", "data": {}},
                    {"id": "scalar", "name": "Bad", "data": 3},
                ],
                "post": [None, {"id": "post", "name": " Post ", "data": {}}],
            }
        ),
        encoding="utf-8",
    )
    loaded = config.load_templates()
    assert loaded["proof"] == [{"id": "kept", "name": "First", "data": {"bg": "#ffffff"}}]
    assert loaded["post"] == [{"id": "post", "name": "Post", "data": {}}]


def test_save_templates_is_atomic_when_replace_fails(monkeypatch, tmp_path):
    monkeypatch.setenv("AZIMUT_HOME", str(tmp_path))
    original = {"schema": 1, "proof": [], "post": []}
    config.save_templates(original)
    before = config.templates_path().read_bytes()

    def fail_replace(_source, _target):
        raise OSError("replace failed")

    monkeypatch.setattr(config.os, "replace", fail_replace)
    with pytest.raises(OSError, match="replace failed"):
        config.save_templates(
            {"schema": 1, "proof": [{"id": "x", "name": "X", "data": {}}], "post": []}
        )

    assert config.templates_path().read_bytes() == before
    assert list(tmp_path.glob(".templates.json.*.tmp")) == []
