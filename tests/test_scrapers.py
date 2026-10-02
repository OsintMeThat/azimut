"""The scraper self-updater: shadowing, fetching, and refusing bad wheels.

Nothing here touches the network or the real yt-dlp/gallery-dl: a synthetic
distribution ("fake-scraper") is registered in SCRAPERS and served from a fake
PyPI, which lets the import-shadowing be tested for real — an actual import
statement resolving to an actual file — without a multi-MB download.
"""

from __future__ import annotations

import hashlib
import importlib
import io
import json
import sys
import zipfile

import pytest

from azimut import config
from azimut.engine import scrapers

MODULE = "azimut_fake_scraper"
DIST = "fake-scraper"


def make_wheel(version: str, module: str = MODULE, package: bool = True) -> bytes:
    """A minimal but structurally real pure-Python wheel."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        if package:
            archive.writestr(f"{module}/__init__.py", f"__version__ = {version!r}\n")
            archive.writestr(f"{module}/deep/__init__.py", "MARKER = 'submodule'\n")
        archive.writestr(
            f"{module}-{version}.dist-info/METADATA",
            f"Metadata-Version: 2.1\nName: {DIST}\nVersion: {version}\n",
        )
        archive.writestr(f"{module}-{version}.dist-info/WHEEL", "Wheel-Version: 1.0\n")
    return buffer.getvalue()


class FakeResponse:
    def __init__(self, payload=None, data=b""):
        self._payload = payload
        self._data = data

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload

    def iter_bytes(self):
        yield self._data

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


@pytest.fixture()
def fake_dist(monkeypatch, tmp_workspace):
    """Register the synthetic distribution and undo every global it touches."""
    monkeypatch.setitem(scrapers.SCRAPERS, DIST, MODULE)
    yield
    scrapers._remove_finder()
    for name in [n for n in sys.modules if n == MODULE or n.startswith(f"{MODULE}.")]:
        del sys.modules[name]
    importlib.invalidate_caches()


def serve(monkeypatch, version: str, wheel: bytes, sha256: str | None = None):
    """Point the updater at a fake PyPI serving `wheel` as the current release."""
    payload = {
        "info": {"version": version},
        "urls": [
            {
                "packagetype": "bdist_wheel",
                "filename": f"{MODULE}-{version}-py3-none-any.whl",
                "url": f"https://example.invalid/{MODULE}-{version}.whl",
                "digests": {"sha256": sha256 or hashlib.sha256(wheel).hexdigest()},
            }
        ],
    }
    monkeypatch.setattr(scrapers.httpx, "get", lambda *a, **k: FakeResponse(payload=payload))
    monkeypatch.setattr(scrapers.httpx, "stream", lambda *a, **k: FakeResponse(data=wheel))
    return payload


# ---- reading state ----------------------------------------------------------


def test_no_runtime_copy_reports_bundled(fake_dist):
    assert scrapers.runtime_version(DIST) is None
    version, source = scrapers.active_version(DIST)
    assert source == "bundled"
    assert version is None  # the synthetic dist isn't actually installed


def test_real_scrapers_report_a_bundled_version(tmp_workspace):
    """The versions we ship are discoverable — status() is never blank."""
    for dist in ("yt-dlp", "gallery-dl"):
        version, source = scrapers.active_version(dist)
        assert source == "bundled"
        assert version, f"no bundled version found for {dist}"


def test_status_does_not_touch_the_network_by_default(monkeypatch, tmp_workspace):
    def explode(*a, **k):
        raise AssertionError("status() reached the network without check_pypi")

    monkeypatch.setattr(scrapers.httpx, "get", explode)
    entries = scrapers.status()
    assert {e["dist"] for e in entries} == {"yt-dlp", "gallery-dl"}
    assert all("latest" not in e for e in entries)


def test_status_check_survives_being_offline(monkeypatch, tmp_workspace):
    def offline(*a, **k):
        raise OSError("no route to host")

    monkeypatch.setattr(scrapers.httpx, "get", offline)
    entries = scrapers.status(check_pypi=True)
    assert all(e["latest"] is None and "check_error" in e for e in entries)
    assert all(e["version"] for e in entries)  # still reports what's in use


# ---- updating ---------------------------------------------------------------


def test_update_fetches_extracts_and_activates(monkeypatch, fake_dist):
    serve(monkeypatch, "1.2.3", make_wheel("1.2.3"))

    result = scrapers.update(DIST)

    assert result["updated"] is True
    assert result["version"] == "1.2.3"
    assert result["restart_required"] is False  # never imported yet
    assert scrapers.runtime_version(DIST) == "1.2.3"
    assert scrapers.active_version(DIST) == ("1.2.3", "runtime")


def test_updated_copy_is_what_import_resolves_to(monkeypatch, fake_dist):
    """The point of the whole module: a real import gets the fetched code."""
    serve(monkeypatch, "9.9.9", make_wheel("9.9.9"))
    scrapers.update(DIST)

    module = importlib.import_module(MODULE)
    assert module.__version__ == "9.9.9"
    assert str(scrapers.dist_dir(DIST)) in module.__file__

    submodule = importlib.import_module(f"{MODULE}.deep")
    assert submodule.MARKER == "submodule"


def test_finder_ignores_everything_else(monkeypatch, fake_dist):
    """The finder is narrow — it must not shadow unrelated imports."""
    serve(monkeypatch, "1.0.0", make_wheel("1.0.0"))
    scrapers.update(DIST)

    assert importlib.import_module("json") is json
    reimported = importlib.import_module("azimut.config")
    assert reimported is config


def test_update_is_idempotent(monkeypatch, fake_dist):
    serve(monkeypatch, "2.0.0", make_wheel("2.0.0"))
    scrapers.update(DIST)

    def explode(*a, **k):
        raise AssertionError("re-downloaded a version already on disk")

    monkeypatch.setattr(scrapers.httpx, "stream", explode)
    result = scrapers.update(DIST)
    assert result["updated"] is False
    assert result["version"] == "2.0.0"


def test_update_replaces_an_older_runtime_copy(monkeypatch, fake_dist):
    serve(monkeypatch, "1.0.0", make_wheel("1.0.0"))
    scrapers.update(DIST)
    serve(monkeypatch, "1.1.0", make_wheel("1.1.0"))
    result = scrapers.update(DIST)

    assert result["previous"] == "1.0.0"
    assert scrapers.runtime_version(DIST) == "1.1.0"
    # exactly one .dist-info — the old one is gone, not merged
    infos = list(scrapers.dist_dir(DIST).glob("*.dist-info"))
    assert [i.name for i in infos] == [f"{MODULE}-1.1.0.dist-info"]


def test_restart_required_once_the_module_is_imported(monkeypatch, fake_dist):
    serve(monkeypatch, "1.0.0", make_wheel("1.0.0"))
    scrapers.update(DIST)
    importlib.import_module(MODULE)  # now cached in sys.modules

    serve(monkeypatch, "1.1.0", make_wheel("1.1.0"))
    result = scrapers.update(DIST)

    assert result["restart_required"] is True
    assert "restart" in result["detail"]
    assert sys.modules[MODULE].__version__ == "1.0.0"  # honest: still the old one


# ---- refusing bad wheels ----------------------------------------------------


def test_hash_mismatch_is_refused(monkeypatch, fake_dist):
    serve(monkeypatch, "6.6.6", make_wheel("6.6.6"), sha256="0" * 64)
    with pytest.raises(RuntimeError, match="hash"):
        scrapers.update(DIST)
    assert scrapers.runtime_version(DIST) is None


def test_a_failed_update_leaves_the_previous_copy_intact(monkeypatch, fake_dist):
    serve(monkeypatch, "1.0.0", make_wheel("1.0.0"))
    scrapers.update(DIST)

    serve(monkeypatch, "2.0.0", make_wheel("2.0.0"), sha256="0" * 64)
    with pytest.raises(RuntimeError):
        scrapers.update(DIST)

    assert scrapers.runtime_version(DIST) == "1.0.0"
    assert not list(scrapers.dist_dir(DIST).parent.glob(".staging-*"))


def test_path_traversal_in_a_wheel_is_refused(monkeypatch, fake_dist):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr(f"{MODULE}/__init__.py", "")
        archive.writestr(f"{MODULE}-1.0.0.dist-info/METADATA", "Version: 1.0.0\n")
        archive.writestr("../../../../evil.py", "pwned = True\n")
    evil = buffer.getvalue()
    serve(monkeypatch, "1.0.0", evil)

    with pytest.raises(RuntimeError, match="unsafe entry"):
        scrapers.update(DIST)
    assert scrapers.runtime_version(DIST) is None


def test_wheel_without_the_package_is_refused(monkeypatch, fake_dist):
    serve(monkeypatch, "1.0.0", make_wheel("1.0.0", package=False))
    with pytest.raises(RuntimeError, match="did not contain"):
        scrapers.update(DIST)
    assert scrapers.runtime_version(DIST) is None


def test_oversized_wheel_is_refused(monkeypatch, fake_dist):
    monkeypatch.setattr(scrapers, "WHEEL_MAX_BYTES", 16)
    serve(monkeypatch, "1.0.0", make_wheel("1.0.0"))
    with pytest.raises(RuntimeError, match="implausibly large"):
        scrapers.update(DIST)


# ---- swapping directories, on every platform --------------------------------


def test_update_over_an_imported_copy(monkeypatch, fake_dist):
    """The Windows-shaped case: replace the package while it's loaded.

    Windows can't delete an open file, so the swap renames the old copy aside
    instead of deleting it in place. This must not raise anywhere.
    """
    serve(monkeypatch, "1.0.0", make_wheel("1.0.0"))
    scrapers.update(DIST)
    importlib.import_module(f"{MODULE}.deep")  # hold the package open

    serve(monkeypatch, "2.0.0", make_wheel("2.0.0"))
    result = scrapers.update(DIST)

    assert result["updated"] is True
    assert scrapers.runtime_version(DIST) == "2.0.0"
    assert (scrapers.dist_dir(DIST) / MODULE / "__init__.py").read_text() == "__version__ = '2.0.0'\n"


def test_swap_leaves_no_litter(monkeypatch, fake_dist):
    serve(monkeypatch, "1.0.0", make_wheel("1.0.0"))
    scrapers.update(DIST)
    serve(monkeypatch, "2.0.0", make_wheel("2.0.0"))
    scrapers.update(DIST)

    leftovers = [p.name for p in config.runtime_dir().glob(".*")]
    assert leftovers == [], f"staging/trash left behind: {leftovers}"


def test_failed_swap_restores_the_working_copy(monkeypatch, fake_dist):
    """If the new copy can't be moved into place, the old one must come back."""
    serve(monkeypatch, "1.0.0", make_wheel("1.0.0"))
    scrapers.update(DIST)

    real_replace = scrapers.Path.replace
    calls = {"n": 0}

    def flaky(self, target):
        calls["n"] += 1
        if calls["n"] == 2:  # 1st = retire the old copy, 2nd = move the new one in
            raise OSError("disk full")
        return real_replace(self, target)

    monkeypatch.setattr(scrapers.Path, "replace", flaky)
    serve(monkeypatch, "2.0.0", make_wheel("2.0.0"))
    with pytest.raises(OSError, match="disk full"):
        scrapers.update(DIST)
    monkeypatch.setattr(scrapers.Path, "replace", real_replace)  # only this one

    assert scrapers.runtime_version(DIST) == "1.0.0"  # still usable
    assert (scrapers.dist_dir(DIST) / MODULE / "__init__.py").exists()


def test_wheel_paths_extract_under_the_dist_dir(monkeypatch, fake_dist):
    """Wheels always use / separators; extraction must land right on Windows too."""
    serve(monkeypatch, "1.0.0", make_wheel("1.0.0"))
    scrapers.update(DIST)
    nested = scrapers.dist_dir(DIST) / MODULE / "deep" / "__init__.py"
    assert nested.is_file()


# ---- reset ------------------------------------------------------------------


def test_reset_falls_back_to_the_bundled_copy(monkeypatch, fake_dist):
    serve(monkeypatch, "1.0.0", make_wheel("1.0.0"))
    scrapers.update(DIST)
    assert scrapers.dist_dir(DIST).exists()

    result = scrapers.reset(DIST)

    assert result["removed"] is True
    assert not scrapers.dist_dir(DIST).exists()
    assert scrapers.active_version(DIST)[1] == "bundled"


def test_reset_when_there_is_nothing_to_reset(fake_dist):
    result = scrapers.reset(DIST)
    assert result["removed"] is False


def test_activate_is_idempotent(monkeypatch, fake_dist):
    serve(monkeypatch, "1.0.0", make_wheel("1.0.0"))
    scrapers.update(DIST)
    for _ in range(3):
        scrapers.activate()
    finders = [f for f in sys.meta_path if isinstance(f, scrapers._RuntimeFinder)]
    assert len(finders) == 1


def _runtime_copy(version: str) -> None:
    root = scrapers.dist_dir(DIST)
    (root / MODULE).mkdir(parents=True)
    (root / MODULE / "__init__.py").write_text(f'__version__ = "{version}"\n', encoding="utf-8")
    (root / f"{MODULE}-{version}.dist-info").mkdir()


@pytest.mark.parametrize(
    ("bundled", "source", "shadowed"),
    [("2026.9.9", "bundled", {}), ("2025.12.31", "runtime", {MODULE: "2026.1.1"})],
)
def test_a_runtime_copy_wins_only_when_newer_than_the_build(monkeypatch, fake_dist, bundled, source, shadowed):
    """An update pressed under an older build must not shadow the newer scraper the
    next build ships: the workspace outlives the program."""
    _runtime_copy("2026.1.1")
    real = importlib.metadata.version
    monkeypatch.setattr(
        scrapers.importlib.metadata, "version", lambda dist: bundled if dist == DIST else real(dist)
    )
    assert scrapers.active_version(DIST) == ("2026.1.1" if source == "runtime" else bundled, source)
    assert scrapers.activate() == shadowed


def test_a_frozen_build_without_metadata_keeps_the_runtime_copy(fake_dist):
    _runtime_copy("2026.1.1")
    assert scrapers.active_version(DIST) == ("2026.1.1", "runtime")
