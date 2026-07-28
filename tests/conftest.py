import tempfile

import pytest
from fastapi.testclient import TestClient

from azimut.engine import geo


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


@pytest.fixture()
def tmp_workspace(monkeypatch):
    """A throwaway workspace root — for engine tests that read/write settings."""
    with tempfile.TemporaryDirectory() as home:
        monkeypatch.setenv("AZIMUT_HOME", home)
        try:
            yield home
        finally:
            _let_the_worker_finish()


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
            _let_the_worker_finish()
