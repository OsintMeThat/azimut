"""The public pages a printed note's sources list under a capture, for a reader to check it.

``tests/fixtures/verify-links.json`` holds each case once; the frontend writes the
same links in a capture's Details (``frontend/src/lib/maplinks.test.js`` reads the
same file), so the two can never drift apart.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from azimut.engine import verifylinks

CASES = json.loads((Path(__file__).parent / "fixtures" / "verify-links.json").read_text(encoding="utf-8"))["cases"]


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_each_capture_gets_the_links_the_frontend_writes(case):
    found = verifylinks.verify_links(case["provider"], case["lat"], case["lon"], case["zoom"], case["day"])
    assert [{"label": label, "url": url} for label, url in found] == case["links"]


def test_the_fixture_covers_both_sites_and_the_refusals():
    sites = {link["label"] for case in CASES for link in case["links"]}
    assert sites == {verifylinks.WAYBACK, verifylinks.COPERNICUS}
    assert sum(1 for case in CASES if not case["links"]) >= 5
