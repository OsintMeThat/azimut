"""The capture extension's own folder: the copy the app writes and can rewrite.

The interesting cases are all failure shapes, and one of them only happens on
Windows: a browser holding a file open while the app tries to replace it. That
one is forced here rather than waited for, because the invariant it protects —
never a half-written extension — is the whole reason the install is staged.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from azimut import config
from azimut.engine import dirswap, extinstall


@pytest.fixture()
def folder(tmp_workspace) -> Path:
    """The app-owned extension folder, in a throwaway workspace root — nothing
    here touches a real installation."""
    return config.extension_dir()


def stamp_of(folder: Path) -> dict:
    return json.loads((folder / extinstall.STAMP_NAME).read_text(encoding="utf-8"))


# -- installing ---------------------------------------------------------------


def test_install_writes_every_shipped_file_and_stamps_it(folder):
    state = extinstall.install()

    src = extinstall.source_dir()
    assert src is not None
    for name, _ in extinstall.shipped_files(src):
        assert (folder / name).is_file(), f"{name} was not written"
    assert state["staged"] is False
    assert state["path"] == str(folder)
    # The stamp answers "is this the copy the app controls", so it carries an id,
    # and "is it behind", so it carries the digest.
    stamp = stamp_of(folder)
    assert stamp["payload"] == extinstall.payload_digest()
    assert stamp["version"] == extinstall.bundled_version()
    assert len(stamp["install_id"]) == 32
    assert state["folder"] == stamp


def test_the_stamp_is_never_part_of_the_payload(folder):
    """It is per-install, so shipping it would make every install differ from
    every other — and the digest gate would never settle."""
    extinstall.install()
    src = extinstall.source_dir()
    assert src is not None
    assert extinstall.STAMP_NAME not in {name for name, _ in extinstall.shipped_files(src)}
    # Nor does installing leave one behind in the source tree (a checkout is the
    # repo's own extension/, which devext.py loads straight into a dev browser).
    assert not (src / extinstall.STAMP_NAME).exists()


def test_a_second_pass_keeps_the_install_id(folder):
    """The id belongs to the folder, not to a payload. Chrome keys storage to the
    extension and the extension to the folder, so an id that moved would read as
    a different install and the analyst would be asked to pair again."""
    first = stamp_of(folder) if folder.exists() else None
    assert first is None
    extinstall.install()
    original = stamp_of(folder)["install_id"]
    extinstall.install()
    assert stamp_of(folder)["install_id"] == original


def test_install_removes_what_the_payload_no_longer_ships(folder):
    extinstall.install()
    stale = folder / "gone.js"
    stale.write_text("old content script", encoding="utf-8")
    nested = folder / "icons" / "gone.png"
    nested.write_bytes(b"stale")

    extinstall.install()

    assert not stale.exists()
    assert not nested.exists()
    assert (folder / "manifest.json").is_file()  # the real payload is untouched


def test_state_reads_without_installing(folder):
    state = extinstall.state()
    assert state["folder"] is None
    assert state["staged"] is False
    assert state["bundled"]["payload"] == extinstall.payload_digest()
    assert not folder.exists()  # a read must not create anything


def test_a_foreign_folder_reports_no_stamp(folder):
    """Someone else's unzip, or a checkout: files are there, the stamp is not, so
    the app knows it does not own this copy."""
    folder.mkdir(parents=True)
    (folder / "manifest.json").write_text('{"version": "0.0.1"}', encoding="utf-8")
    assert extinstall.state()["folder"] is None


def test_an_unreadable_stamp_reads_as_no_stamp(folder):
    extinstall.install()
    (folder / extinstall.STAMP_NAME).write_text("{ not json", encoding="utf-8")
    assert extinstall.state()["folder"] is None


# -- a browser holding the files (Windows) ------------------------------------


def _refuse_after(count: int, monkeypatch: pytest.MonkeyPatch) -> dict:
    """Let `count` replacements through, then refuse every one — the shape of a
    browser holding a file open on Windows.

    Returns a switch to turn the refusal off again. Not ``monkeypatch.undo()``:
    that also reverts the ``AZIMUT_HOME`` the workspace fixture set, so the next
    pass would write into the developer's real workspace.
    """
    real = os.replace
    gate = {"n": 0, "refusing": True}

    def fake(src, dst, *args, **kwargs):
        gate["n"] += 1
        if gate["refusing"] and gate["n"] > count:
            raise PermissionError(32, "being used by another process")
        return real(src, dst, *args, **kwargs)

    monkeypatch.setattr(dirswap.os, "replace", fake)
    # The retry ladder sleeps between attempts; there is nothing to wait for here.
    monkeypatch.setattr(dirswap.time, "sleep", lambda _s: None)
    return gate


def test_a_refused_replace_is_staged_not_half_written(folder, monkeypatch):
    extinstall.install()
    before = stamp_of(folder)

    _refuse_after(2, monkeypatch)
    state = extinstall.install()

    assert state["staged"] is True
    # The manifest is written last, so an interrupted pass leaves one that still
    # describes a loadable extension.
    manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["version"] == before["version"]
    # And the stamp still describes what is actually loadable, never the payload
    # that failed to land.
    assert stamp_of(folder) == before


def test_the_next_pass_finishes_a_staged_one(folder, monkeypatch):
    extinstall.install()
    gate = _refuse_after(1, monkeypatch)
    assert extinstall.install()["staged"] is True

    gate["refusing"] = False  # the browser let go
    state = extinstall.install()

    assert state["staged"] is False
    assert state["folder"]["payload"] == extinstall.payload_digest()
    # Exactly one staging directory can exist, and a finished pass leaves none —
    # otherwise "staged" would stay true forever after one refusal.
    assert not [p for p in folder.iterdir() if p.name.startswith(".staging-")]


def test_a_rename_aside_covers_a_replace_windows_refuses(folder, tmp_path):
    """os.replace onto an open file fails on Windows where a rename still works,
    so the ladder tries that before giving up."""
    target = tmp_path / "held.js"
    target.write_text("old", encoding="utf-8")
    source = tmp_path / "new.js"
    source.write_text("new", encoding="utf-8")

    calls = {"n": 0}
    real = os.replace

    def only_direct_replace_fails(src, dst, *args, **kwargs):
        calls["n"] += 1
        if Path(dst) == target and calls["n"] <= dirswap.REPLACE_ATTEMPTS:
            raise PermissionError(32, "being used by another process")
        return real(src, dst, *args, **kwargs)

    original_sleep = dirswap.time.sleep
    dirswap.time.sleep = lambda _s: None
    dirswap.os.replace = only_direct_replace_fails
    try:
        dirswap.replace_file(source, target)
    finally:
        dirswap.os.replace = real
        dirswap.time.sleep = original_sleep

    assert target.read_text(encoding="utf-8") == "new"
    assert not source.exists()


def test_leftovers_are_swept_and_never_reported_as_content(folder):
    extinstall.install()
    (folder / ".old-manifest.json-abcd").write_text("litter", encoding="utf-8")
    (folder / ".trash-icons-abcd").mkdir()

    state = extinstall.state()

    assert state["staged"] is False
    assert not (folder / ".old-manifest.json-abcd").exists()
    assert not (folder / ".trash-icons-abcd").exists()


# -- the routes ---------------------------------------------------------------


def test_the_install_route_takes_nothing_and_reports_the_folder(client):
    body = client.post("/api/settings/extension/install").json()
    assert body["staged"] is False
    assert body["folder"]["payload"] == body["bundled"]["payload"]
    assert Path(body["path"]).is_dir()


def test_the_state_route_reads_without_writing(client):
    body = client.get("/api/settings/extension").json()
    assert body["folder"] is None
    assert body["bundled"]["version"] == extinstall.bundled_version()
    assert not Path(body["path"]).exists()


def test_revealing_before_installing_is_a_404(client):
    assert client.post("/api/settings/extension/reveal").status_code == 404


def test_the_install_route_is_not_in_the_extension_cors_island(client):
    """/api/ingest/* is opened to any extension origin on purpose. A route that
    writes to disk must not inherit that, so it lives on the settings router and
    the browser's same-origin default is what guards it."""
    for path in ("/api/settings/extension", "/api/settings/extension/install"):
        response = client.options(
            path,
            headers={
                "Origin": "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
                "Access-Control-Request-Method": "POST",
            },
        )
        assert "access-control-allow-origin" not in {k.lower() for k in response.headers}
