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


def test_every_site_is_asked_for_at_run_time_only(manifest):
    """The panel's Add reads the page in front, which a press in a side panel never
    opens to the extension (the owner's choice of 2026-11-06, SPEC §9). So every
    site is an optional permission, asked the first time Add needs a page: never a
    required one, which Chrome would warn of at install and Firefox would hold its
    silent update behind."""
    assert manifest["optional_host_permissions"] == ["<all_urls>"]
    assert "<all_urls>" not in manifest["host_permissions"]
    assert "<all_urls>" not in manifest["permissions"]
    assert all("<all_urls>" not in script["matches"] for script in manifest["content_scripts"])


def test_the_capture_shortcut_is_declared(manifest):
    """A shortcut opens the tab as a right-click does: it captures without the permission."""
    command = manifest["commands"]["capture-note"]
    assert command["suggested_key"]["default"] == "Alt+Shift+S"
    worker = (EXT / "background.js").read_text(encoding="utf-8")
    assert '"capture-note"' in worker


def test_the_helpers_load_before_the_worker_in_both_browsers(manifest):
    """Firefox runs the listed scripts in order; Chrome's worker imports them."""
    assert manifest["background"]["scripts"] == ["notesmsg.js", "mapsites.js", "background.js"]
    worker = (EXT / manifest["background"]["service_worker"]).read_text(encoding="utf-8")
    assert 'importScripts("notesmsg.js")' in worker
    assert 'importScripts("mapsites.js")' in worker


def test_the_toolbar_button_is_the_workers_once_paired(manifest):
    """No popup in the manifest: a press reaches the worker, which opens the tools
    over a map or the note anywhere else, and sets the pairing popup itself while
    there is no token (``background.js``, "the toolbar button")."""
    assert "default_popup" not in manifest["action"]
    worker = (EXT / "background.js").read_text(encoding="utf-8")
    assert 'popup: token ? "" : "popup.html"' in worker
    assert (EXT / "popup.html").is_file()


def test_the_note_has_a_shortcut_of_its_own(manifest):
    """A shortcut is a press: it opens the side panel where a click in a page cannot."""
    command = manifest["commands"]["open-note"]
    assert command["suggested_key"]["default"] == "Alt+Shift+N"
    keys = [c["suggested_key"]["default"] for c in manifest["commands"].values()]
    # Chrome takes four suggested shortcuts at most, and two alike would clash
    assert len(keys) <= 4 and len(set(keys)) == len(keys)


def test_every_script_the_panel_page_loads_ships(manifest):
    page = (EXT / "notes.html").read_text(encoding="utf-8")
    scripts = re.findall(r'<script src="([^"]+)"', page)
    assert scripts == ["notesmsg.js", "notes.js"]
    for script in scripts:
        assert (EXT / script).is_file()
    for size, icon in manifest["sidebar_action"]["default_icon"].items():
        assert (EXT / icon).is_file(), size
