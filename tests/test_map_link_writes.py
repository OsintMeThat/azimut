"""A linked view, written into a map site's address, read back by the app.

The extension's map tools follow another map by writing its camera into the
site's own URL (``extension/maplink.js``). The tools then read their scale from
that same URL through ``parse_map_url``, so the two have to agree: a writer that
puts a level where the parser reads metres, or a fraction where the site loads a
whole level, draws every mark at the wrong size until the map is touched.

``tests/fixtures/map-link-writes.json`` holds each write once. The frontend
suite asserts the writer still produces those URLs
(``frontend/src/lib/extensionMapLink.test.js``); this one asserts the app's
parser reads each of them as the view that was meant, so there is still only
one parser.
"""

import json
from pathlib import Path

import pytest

from azimut.engine.mapsites import parse_map_url

WRITES = json.loads(
    (Path(__file__).parent / "fixtures" / "map-link-writes.json").read_text(encoding="utf-8")
)["writes"]


def _id(case):
    return f"{case['site']}: {case['name']}"


@pytest.mark.parametrize("case", WRITES, ids=_id)
def test_the_page_written_from_is_the_site_named(case):
    assert parse_map_url(case["from"], case["height"])["site"] == case["site"]


@pytest.mark.parametrize("case", WRITES, ids=_id)
def test_the_written_address_reads_back_as_the_view(case):
    parsed = parse_map_url(case["url"], case["height"])
    lands = case["lands"]
    assert parsed["site"] == case["site"]
    assert parsed["lat"] == pytest.approx(lands["lat"], abs=1e-5)
    assert parsed["lon"] == pytest.approx(lands["lon"], abs=1e-5)
    if lands["zoom"] is None:
        # a view Earth never placed: no scale until a gesture places it
        assert parsed["zoom"] is None
    else:
        assert parsed["zoom"] == pytest.approx(lands["zoom"], abs=0.01)


def test_every_site_the_writer_knows_is_covered():
    sites = {case["site"] for case in WRITES}
    assert sites == {
        "google-maps",
        "google-earth",
        "bing-maps",
        "yandex-maps",
        "openstreetmap",
        "apple-maps",
        "zoom-earth",
        "satellites-pro",
        "copernicus-browser",
    }
