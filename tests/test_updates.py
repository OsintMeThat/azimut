"""App self-update check (engine/updates.py, api/settings.py) and the bundled
capture-extension version Settings compares against the installed one.

Nothing here touches the network: GitHub's releases feed is faked, and the
opt-in gate (``?check=true``) is asserted by making the fake explode when it
shouldn't be reached."""

from __future__ import annotations

import httpx
import pytest

from azimut import __version__
from azimut.api.ingest import bundled_extension_version
from azimut.engine import updates


class FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


# -- version comparison ---------------------------------------------------


@pytest.mark.parametrize(
    "latest,current,expected",
    [
        ("v0.2.0", "0.1.1", True),
        ("v0.1.2", "0.1.1", True),
        ("v0.1.1", "0.1.1", False),
        ("v0.1.0", "0.1.1", False),
        ("0.1.10", "0.1.9", True),  # numeric, not lexical
        ("v0.2.0rc1", "0.1.9", True),  # pre-release suffix ignored
    ],
)
def test_is_newer(latest, current, expected):
    assert updates.is_newer(latest, current) is expected


# -- updates.check --------------------------------------------------------


def test_check_reports_a_newer_release(monkeypatch):
    monkeypatch.setattr(
        updates.httpx,
        "get",
        lambda *a, **k: FakeResponse({"tag_name": "v9.9.9", "html_url": "https://x/rel"}),
    )
    result = updates.check("0.1.1")
    assert result == {
        "current": "0.1.1",
        "latest": "v9.9.9",
        "update_available": True,
        "url": "https://x/rel",
        "notes": "",
    }


def test_check_carries_release_notes_capped(monkeypatch):
    monkeypatch.setattr(
        updates.httpx,
        "get",
        lambda *a, **k: FakeResponse(
            {"tag_name": "v9.9.9", "body": "  ## What's new\n- stuff  " + "x" * 9000}
        ),
    )
    result = updates.check("0.1.1")
    assert result["notes"].startswith("## What's new")  # stripped
    assert len(result["notes"]) == updates.NOTES_LIMIT  # capped


def test_check_up_to_date(monkeypatch):
    monkeypatch.setattr(
        updates.httpx, "get", lambda *a, **k: FakeResponse({"tag_name": "v0.1.1"})
    )
    result = updates.check("0.1.1")
    assert result["update_available"] is False
    assert result["latest"] == "v0.1.1"


def test_check_never_raises_on_network_error(monkeypatch):
    def boom(*a, **k):
        raise httpx.ConnectError("offline")

    monkeypatch.setattr(updates.httpx, "get", boom)
    result = updates.check("0.1.1")
    assert result["update_available"] is False
    assert "offline" in result["error"]


# -- endpoint (opt-in, local-first) ---------------------------------------


def test_update_endpoint_without_check_touches_no_network(client, monkeypatch):
    def boom(*a, **k):
        raise AssertionError("must not reach the network without ?check=true")

    monkeypatch.setattr(updates.httpx, "get", boom)
    body = client.get("/api/settings/update").json()
    assert body == {"current": __version__, "latest": None, "update_available": False}


def test_update_endpoint_with_check_queries_github(client, monkeypatch):
    monkeypatch.setattr(
        updates.httpx,
        "get",
        lambda *a, **k: FakeResponse({"tag_name": "v9.9.9", "html_url": "https://x/rel"}),
    )
    body = client.get("/api/settings/update?check=true").json()
    assert body["update_available"] is True
    assert body["latest"] == "v9.9.9"


# -- bundled extension version --------------------------------------------


def test_bundled_extension_version_matches_manifest():
    # The repo checkout's extension/manifest.json is the source of truth here.
    assert bundled_extension_version() == "0.2.0"


def test_settings_reports_extension_version(client):
    body = client.get("/api/settings").json()
    assert body["extension_version"] == "0.2.0"
