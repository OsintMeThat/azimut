"""App self-update check (engine/updates.py, api/settings.py) and the bundled
capture-extension version Settings compares against the installed one.

Nothing here touches the network: GitHub's releases feed is faked, and the
opt-in gate (``?check=true``) is asserted by making the fake explode when it
shouldn't be reached."""

from __future__ import annotations

import hashlib
import json
from pathlib import PurePosixPath

import httpx
import pytest

from azimut import __version__
from azimut.api.ingest import _extension_dir, bundled_extension_version, shipped_extension_files
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
    body = "  ## What's new\n- stuff\n" + "".join(f"- entry {i}\n" for i in range(900))
    monkeypatch.setattr(
        updates.httpx,
        "get",
        lambda *a, **k: FakeResponse({"tag_name": "v9.9.9", "body": body}),
    )
    result = updates.check("0.1.1")
    notes = result["notes"]
    assert notes.startswith("## What's new")  # stripped
    assert len(notes) <= updates.NOTES_LIMIT  # capped
    # cut on a line boundary, so the pop-up never renders half a line
    assert notes.splitlines()[-1] in body.splitlines()


def test_check_caps_a_release_note_with_no_line_break(monkeypatch):
    monkeypatch.setattr(
        updates.httpx,
        "get",
        lambda *a, **k: FakeResponse({"tag_name": "v9.9.9", "body": "x" * 9000}),
    )
    assert len(updates.check("0.1.1")["notes"]) == updates.NOTES_LIMIT


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

# The extension carries the Azimut version whose release last changed it, not
# the current one. Settings turns "bundled > installed" into "replace the
# unpacked folder and reload", so bumping this in lock-step with __version__
# would send every user through a reinstall for a byte-identical zip.
#
# The pair below is the contract, and it moves in one direction only: when a
# shipped file really changes, set the manifest to the current __version__ and
# record the new digest here (the failing test prints it).
EXTENSION_VERSION = "0.2.5"
EXTENSION_PAYLOAD = "f8141fe57fed06b98f373446d8fc19e932a988d1cc27fdcc7d632ae1b65bb198"

# Text is digested by its line content: a Windows checkout can carry CRLF, and
# the gate has to reach the same verdict on the three CI platforms.
_TEXT_SUFFIXES = {".js", ".json", ".css", ".html", ".md", ".txt"}


def _extension_payload_digest() -> str:
    """Digest everything ``extension.zip`` ships, minus the manifest's own
    ``version``.

    Leaving the version out is what makes the gate cut both ways: with it in,
    any bump would change the digest and a gratuitous one would look exactly
    like a real change."""
    src = _extension_dir()
    assert src is not None, "no extension bundled with this checkout"
    digest = hashlib.sha256()
    for name, path in shipped_extension_files(src):
        if name == "manifest.json":
            manifest = json.loads(path.read_text(encoding="utf-8"))
            manifest.pop("version", None)
            data = json.dumps(manifest, sort_keys=True).encode("utf-8")
        else:
            data = path.read_bytes()
            if PurePosixPath(name).suffix in _TEXT_SUFFIXES:
                data = data.replace(b"\r\n", b"\n")
        digest.update(f"{name}\0".encode() + data + b"\0")
    return digest.hexdigest()


def test_the_shipped_listing_reads_the_same_on_every_platform():
    """The digest above folds the names in order, so the order is part of the gate.

    Sorting `Path` objects would not do: comparing them is case-insensitive on
    Windows and case-sensitive everywhere else, which puts `README.md` first on
    Linux and mid-list on Windows — three CI platforms disagreeing about one
    unchanged extension. Sorted by the posix name instead, which is the same
    string on all three.
    """
    src = _extension_dir()
    assert src is not None
    names = [name for name, _ in shipped_extension_files(src)]
    assert names == sorted(names)
    assert all("\\" not in name for name in names)


def test_the_extension_version_moves_only_when_the_extension_does():
    """Both halves of the drift, in one gate.

    A shipped file changed without a version bump: the installed extension and
    the bundled one report the same version while differing, so Settings stays
    quiet and the user keeps running a stale bridge. A version bump with no
    change: everyone is told to reinstall the zip they already have, and a nag
    that cries wolf is a nag nobody reads."""
    digest = _extension_payload_digest()
    version = bundled_extension_version()

    assert digest == EXTENSION_PAYLOAD, (
        f"the shipped extension changed. Set extension/manifest.json to the current "
        f'__version__ ({__version__}) and record EXTENSION_VERSION = "{__version__}", '
        f'EXTENSION_PAYLOAD = "{digest}" here.'
    )
    assert version == EXTENSION_VERSION, (
        f"the extension is unchanged but its version moved to {version}. Put "
        f"extension/manifest.json back to {EXTENSION_VERSION} — a bump users can't "
        f"see is a reinstall prompt they don't need."
    )


def test_the_bundled_extension_is_never_ahead_of_the_app():
    """It is stamped with the Azimut version that shipped it, so it can lag by
    several releases but never lead — a version no release ever carried would
    make the Settings comparison meaningless."""
    assert not updates.is_newer(EXTENSION_VERSION, __version__)


def test_settings_reports_extension_version(client):
    body = client.get("/api/settings").json()
    assert body["extension_version"] == EXTENSION_VERSION
