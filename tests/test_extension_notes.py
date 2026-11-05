"""The notes panel, as the extension's manifest declares it to two browsers.

One manifest serves Chrome and Firefox, and each reads the other's panel key as
an unknown one: Chrome opens ``side_panel``, Firefox ``sidebar_action``, and both
must name the same page or the panel is a different thing in each browser. The
behaviour is tested in ``frontend/src/lib/extensionNotes*.test.js``; this pins
what the browsers read before any of it runs, including what the panel must not
cost: no new host, and no permission that would hold Firefox's silent update
behind a prompt.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

EXT = Path(__file__).resolve().parent.parent / "extension"

#: The hosts the extension already reached before the panel existed. The panel
#: reads pages through the right-click (``activeTab``) and needs none of its own.
HOSTS = {
    "http://127.0.0.1/*",
    "http://localhost/*",
    "https://x.com/*",
    "https://twitter.com/*",
    "https://bsky.app/*",
    "https://lens.google.com/*",
    "https://www.google.com/*",
    "https://yandex.com/*",
    "https://www.bing.com/*",
    "https://tineye.com/*",
}


@pytest.fixture(scope="module")
def manifest() -> dict:
    return json.loads((EXT / "manifest.json").read_text(encoding="utf-8"))


def test_both_browsers_open_the_same_panel_page(manifest):
    chrome_page = manifest["side_panel"]["default_path"]
    firefox_page = manifest["sidebar_action"]["default_panel"]
    assert chrome_page == firefox_page == "notes.html"
    assert (EXT / chrome_page).is_file()


def test_firefox_does_not_open_the_sidebar_on_install(manifest):
    """Firefox opens a new sidebar at install unless told otherwise, and an update
    of the signed add-on is an install: the panel would pop open on everyone."""
    assert manifest["sidebar_action"]["open_at_install"] is False


def test_the_panel_asks_only_for_what_it_uses(manifest):
    permissions = set(manifest["permissions"])
    # the right-click items (Firefox reads `contextMenus` as `menus`), and Chrome's panel
    assert {"contextMenus", "sidePanel"} <= permissions
    # `tabs` would hold Firefox's automatic update behind a permission prompt and
    # warn of browsing history in Chrome; the right-click opens the tab instead
    assert "tabs" not in permissions
    assert set(manifest["host_permissions"]) == HOSTS
    assert "optional_host_permissions" not in manifest
    assert "<all_urls>" not in json.dumps(manifest)


def test_the_helpers_load_before_the_worker_in_both_browsers(manifest):
    """Firefox runs the listed scripts in order; Chrome's worker imports them."""
    assert manifest["background"]["scripts"] == ["notesmsg.js", "background.js"]
    worker = (EXT / manifest["background"]["service_worker"]).read_text(encoding="utf-8")
    assert 'importScripts("notesmsg.js")' in worker


def test_every_script_the_panel_page_loads_ships(manifest):
    page = (EXT / "notes.html").read_text(encoding="utf-8")
    scripts = re.findall(r'<script src="([^"]+)"', page)
    assert scripts == ["notesmsg.js", "notes.js"]
    for script in scripts:
        assert (EXT / script).is_file()
    for size, icon in manifest["sidebar_action"]["default_icon"].items():
        assert (EXT / icon).is_file(), size
