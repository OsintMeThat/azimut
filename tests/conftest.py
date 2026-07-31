import tempfile

import pytest
from fastapi.testclient import TestClient

from azimut import config
from azimut.engine import geo


@pytest.fixture(autouse=True)
def isolated_workspace_pointer(monkeypatch, tmp_path_factory):
    """No test may read or write this machine's real workspace.

    Two addresses have to be redirected, because the app resolves its root from
    both. The pointer deliberately lives outside the workspace, so a temporary
    ``AZIMUT_HOME`` does not contain it: without this, one test writing a pointer
    would re-point the developer's own Azimut at a directory pytest deletes on
    the way out. ``DEFAULT_ROOT`` is the fallback the app lands on the moment a
    test clears that pointer, and opening a workspace migrates every case in it —
    so leaving it at ``~/Azimut`` would run the suite's migrations over the
    developer's real cases.
    """
    directory = tmp_path_factory.mktemp("pointer")
    monkeypatch.setattr(config, "_pointer_dir", lambda: directory)
    monkeypatch.setattr(config, "DEFAULT_ROOT", tmp_path_factory.mktemp("default-root"))
    config.forget_workspace_root()
    yield
    config.forget_workspace_root()


@pytest.fixture(autouse=True)
def offline_reverse_geocode(monkeypatch):
    """Nominatim is unreachable unless a test says otherwise.

    Saving a place or a capture now resolves its country as part of the save, so
    without this the suite would fire a live lookup per saved item. Tests that
    care about the located path stub ``geo.reverse_geocode`` themselves; every
    other one gets the offline verdict (``failed``), which is what the app is
    designed to survive.
    """
    monkeypatch.setattr(geo, "reverse_geocode", lambda lat, lon, timeout=8, language=None: None)


def _let_the_worker_finish() -> None:
    """Wait for the shared background worker before a throwaway workspace is
    removed.

    Importing media queues enrichment, so a test that never mentions jobs can
    still leave the worker mid-write when its temp directory goes — which on
    POSIX surfaces as a "directory not empty" teardown error and on Windows as a
    locked file. This is the same orderly-shutdown wait the app itself performs.
    """
    from azimut.engine import workqueue

    workqueue.wait_until_idle(timeout=10)


def _settle_before_the_workspace_goes() -> None:
    """Everything that must let go of a throwaway workspace before it is deleted.

    Both holds are file handles, and Windows refuses to delete a file another
    handle has open, so a test that keeps one fails the *teardown* — sometimes
    its own, sometimes a later test's. The worker is waited out; the workspace
    lock is released, which is what closes its handle.

    Not an autouse fixture on purpose: an autouse fixture is set up before the
    one that owns the temporary directory and therefore torn down *after* it, so
    the release would come too late to be the point of it. Called from the
    fixtures that own the directory instead, where the order is guaranteed.
    """
    from azimut.engine import workspacelock

    _let_the_worker_finish()
    workspacelock.release()


@pytest.fixture()
def tmp_workspace(monkeypatch):
    """A throwaway workspace root — for engine tests that read/write settings."""
    with tempfile.TemporaryDirectory() as home:
        monkeypatch.setenv("AZIMUT_HOME", home)
        try:
            yield home
        finally:
            _settle_before_the_workspace_goes()


@pytest.fixture()
def client(monkeypatch):
    """API client backed by a throwaway workspace root."""
    with tempfile.TemporaryDirectory() as home:
        monkeypatch.setenv("AZIMUT_HOME", home)
        from azimut.server import create_app

        # base_url is a loopback host so the app's own Host guard (server.py
        # install_local_guard) lets requests through, as a real browser would.
        try:
            with TestClient(create_app(), base_url="http://127.0.0.1") as c:
                yield c
        finally:
            _settle_before_the_workspace_goes()
