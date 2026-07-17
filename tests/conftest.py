import os
import tempfile

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def tmp_workspace(monkeypatch):
    """A throwaway workspace root — for engine tests that read/write settings."""
    with tempfile.TemporaryDirectory() as home:
        monkeypatch.setenv("AZIMUT_HOME", home)
        yield home


@pytest.fixture()
def client(monkeypatch):
    """API client backed by a throwaway workspace root."""
    with tempfile.TemporaryDirectory() as home:
        monkeypatch.setenv("AZIMUT_HOME", home)
        from azimut.server import create_app

        # base_url is a loopback host so the app's own Host guard (server.py
        # install_local_guard) lets requests through, as a real browser would.
        with TestClient(create_app(), base_url="http://127.0.0.1") as c:
            yield c
