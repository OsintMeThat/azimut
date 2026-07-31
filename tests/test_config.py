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
    assert config.cases_dir() == tmp_path
    assert config.internal_dir() == tmp_path / ".azimut"
    assert config.settings_dir() == tmp_path / ".azimut" / "settings"
    assert config.scratch_dir() == tmp_path / ".azimut" / "scratch"
    assert config.bundles_dir() == tmp_path / ".azimut" / "bundles"
    assert config.runtime_dir() == tmp_path / ".azimut" / "runtime"
    assert config.tile_cache_dir() == tmp_path / ".azimut" / "cache" / "tiles"
    assert config.settings_path().parent == config.settings_dir()
    saved = json.loads(config.settings_path().read_text(encoding="utf-8"))
    assert saved["usage"] == {}
    assert saved["tile_providers"] == []


def test_ensure_workspace_moves_legacy_settings_files_once(monkeypatch, tmp_path):
    monkeypatch.setenv("AZIMUT_HOME", str(tmp_path))
    legacy = {
        "settings.json": json.dumps({**config.DEFAULT_SETTINGS, "units": "imperial"}).encode(),
        "templates.json": b'{"schema": 1, "proof": [], "post": []}\n',
        "signature.png": config.PNG_MAGIC + b"logo",
        "cookies.txt": b"# Netscape HTTP Cookie File\n",
    }
    for name, content in legacy.items():
        (tmp_path / name).write_bytes(content)

    config.ensure_workspace()

    assert config.load_settings()["units"] == "imperial"
    assert config.templates_path().read_bytes() == legacy["templates.json"]
    assert config.signature_path().read_bytes() == legacy["signature.png"]
    assert config.cookies_file_path().read_bytes() == legacy["cookies.txt"]
    assert not any((tmp_path / name).exists() for name in legacy)
    before = {path.name: path.read_bytes() for path in config.settings_dir().iterdir()}

    config.ensure_workspace()

    assert {path.name: path.read_bytes() for path in config.settings_dir().iterdir()} == before


def test_workspace_settings_migration_preserves_a_conflicting_legacy_file(monkeypatch, tmp_path):
    monkeypatch.setenv("AZIMUT_HOME", str(tmp_path))
    config.settings_dir().mkdir(parents=True)
    config.settings_path().write_text(
        json.dumps({**config.DEFAULT_SETTINGS, "units": "metric"}),
        encoding="utf-8",
    )
    legacy = json.dumps({**config.DEFAULT_SETTINGS, "units": "imperial"}).encode()
    (tmp_path / "settings.json").write_bytes(legacy)

    config.ensure_workspace()

    assert config.load_settings()["units"] == "metric"
    assert not (tmp_path / "settings.json").exists()
    assert (config.settings_dir() / "settings.legacy.json").read_bytes() == legacy


def test_workspace_settings_migration_resumes_after_a_partial_move(monkeypatch, tmp_path):
    monkeypatch.setenv("AZIMUT_HOME", str(tmp_path))
    config.settings_dir().mkdir(parents=True)
    config.settings_path().write_text(json.dumps(config.DEFAULT_SETTINGS), encoding="utf-8")
    (tmp_path / "templates.json").write_text(json.dumps(config.DEFAULT_TEMPLATES), encoding="utf-8")
    (tmp_path / "signature.png").write_bytes(config.PNG_MAGIC + b"logo")

    config.ensure_workspace()

    assert config.settings_path().is_file()
    assert config.templates_path().is_file()
    assert config.signature_path().is_file()
    assert not (tmp_path / "templates.json").exists()
    assert not (tmp_path / "signature.png").exists()


def test_workspace_settings_migration_absorbs_the_intermediate_dot_directory(monkeypatch, tmp_path):
    monkeypatch.setenv("AZIMUT_HOME", str(tmp_path))
    intermediate = tmp_path / ".settings"
    intermediate.mkdir()
    (intermediate / "settings.json").write_text(
        json.dumps({**config.DEFAULT_SETTINGS, "units": "imperial"}),
        encoding="utf-8",
    )
    (intermediate / "extra.txt").write_text("preserved", encoding="utf-8")

    config.ensure_workspace()

    assert config.load_settings()["units"] == "imperial"
    assert (config.settings_dir() / "extra.txt").read_text(encoding="utf-8") == "preserved"
    assert not intermediate.exists()


def test_workspace_layout_migration_flattens_cases_and_hides_machinery(monkeypatch, tmp_path):
    monkeypatch.setenv("AZIMUT_HOME", str(tmp_path))
    old_case = tmp_path / "cases" / "harbour"
    old_case.mkdir(parents=True)
    (old_case / "case.json").write_text("case", encoding="utf-8")
    for name, marker in (
        ("scratch", "session"),
        ("bundles", "export.azimut.zip"),
        ("runtime", "yt-dlp"),
        ("tile-cache", "tile.jpg"),
    ):
        directory = tmp_path / name / marker
        directory.parent.mkdir(parents=True, exist_ok=True)
        directory.write_text(name, encoding="utf-8")

    config.ensure_workspace()

    assert (tmp_path / "harbour" / "case.json").read_text(encoding="utf-8") == "case"
    assert (config.scratch_dir() / "session").read_text(encoding="utf-8") == "scratch"
    assert (config.bundles_dir() / "export.azimut.zip").read_text(encoding="utf-8") == "bundles"
    assert (config.runtime_dir() / "yt-dlp").read_text(encoding="utf-8") == "runtime"
    assert (config.tile_cache_dir() / "tile.jpg").read_text(encoding="utf-8") == "tile-cache"
    assert not any(
        (tmp_path / name).exists()
        for name in ("cases", "scratch", "bundles", "runtime", "tile-cache")
    )


def test_workspace_layout_migration_resumes_a_partially_moved_directory(monkeypatch, tmp_path):
    monkeypatch.setenv("AZIMUT_HOME", str(tmp_path))
    old = tmp_path / "scratch" / "old-session"
    old.mkdir(parents=True)
    (old / "case.json").write_text("old", encoding="utf-8")
    current = config.scratch_dir() / "current-session"
    current.mkdir(parents=True)
    (current / "case.json").write_text("current", encoding="utf-8")

    config.ensure_workspace()
    config.ensure_workspace()

    assert (config.scratch_dir() / "old-session" / "case.json").is_file()
    assert (config.scratch_dir() / "current-session" / "case.json").is_file()
    assert not (tmp_path / "scratch").exists()


def test_workspace_layout_migration_refuses_to_overwrite_a_case_collision(monkeypatch, tmp_path):
    monkeypatch.setenv("AZIMUT_HOME", str(tmp_path))
    legacy = tmp_path / "cases" / "same-name"
    current = tmp_path / "same-name"
    legacy.mkdir(parents=True)
    current.mkdir()
    (legacy / "case.json").write_text("legacy", encoding="utf-8")
    (current / "case.json").write_text("current", encoding="utf-8")

    with pytest.raises(config.WorkspaceMigrationError, match="refuses to merge"):
        config.ensure_workspace()

    assert (legacy / "case.json").read_text(encoding="utf-8") == "legacy"
    assert (current / "case.json").read_text(encoding="utf-8") == "current"


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


def test_default_download_cookies_is_off():
    assert config.DEFAULT_SETTINGS["download_cookies"] == {"source": "none"}


def test_load_settings_back_compat_missing_download_cookies(monkeypatch, tmp_path):
    """A settings.json predating gated downloads back-fills the default (off),
    so behavior is unchanged until the user opts in."""
    monkeypatch.setenv("AZIMUT_HOME", str(tmp_path))
    config.settings_path().parent.mkdir(parents=True, exist_ok=True)
    config.settings_path().write_text(
        json.dumps({"tile_providers": [], "api_keys": {}}), encoding="utf-8"
    )
    loaded = config.load_settings()
    assert loaded["download_cookies"] == {"source": "none"}


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
    assert list(config.settings_dir().glob(".settings.json.*.tmp")) == []


@pytest.mark.parametrize(
    "content",
    [
        "[]",
        "{",
        '{"schema": 2, "proof": [], "post": []}',
        '{"schema": 1, "proof": [42], "post": []}',
    ],
)
def test_load_templates_recovers_from_malformed_stores(monkeypatch, tmp_path, content):
    monkeypatch.setenv("AZIMUT_HOME", str(tmp_path))
    config.templates_path().parent.mkdir(parents=True)
    config.templates_path().write_text(content, encoding="utf-8")
    assert config.load_templates() == config.DEFAULT_TEMPLATES


def test_load_templates_filters_bad_records_and_duplicate_ids(monkeypatch, tmp_path):
    monkeypatch.setenv("AZIMUT_HOME", str(tmp_path))
    config.templates_path().parent.mkdir(parents=True)
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
    assert list(config.settings_dir().glob(".templates.json.*.tmp")) == []
