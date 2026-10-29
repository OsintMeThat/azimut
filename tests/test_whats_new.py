"""What's new for the version being made (frontend/src/lib/whatsNew.json).

The app opens on it for everyone who updates (components/Onboarding.svelte), so a
version must carry one. While a release is prepared it is a draft, written against
the screens as they stand; the release itself refuses a draft, so the pages are
rewritten on the finished app before it ships. The release workflow sets
AZIMUT_RELEASE on a tag, and only then is a draft a failure.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from azimut import __version__

WHATS_NEW = Path(__file__).resolve().parents[1] / "frontend" / "src" / "lib" / "whatsNew.json"


def _entry() -> dict:
    book = json.loads(WHATS_NEW.read_text(encoding="utf-8"))
    assert __version__ in book, f"whatsNew.json has no entry for {__version__}: write its pages"
    return book[__version__]


def test_the_version_being_made_has_a_whats_new():
    entry = _entry()
    assert 1 <= len(entry["pages"]) <= 5


@pytest.mark.skipif(not os.environ.get("AZIMUT_RELEASE"), reason="only a release refuses a draft")
def test_a_release_ships_no_draft_whats_new():
    assert not _entry().get("draft"), (
        f"What's new for {__version__} is still a draft: rewrite its pages and pictures on the "
        "finished app, then drop \"draft\" from frontend/src/lib/whatsNew.json"
    )
