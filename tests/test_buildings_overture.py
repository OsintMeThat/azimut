"""Overture's footprints: the newest release, whose heights are what, and a release taken down."""

from __future__ import annotations

import json

import httpx
import numpy as np
import pytest

from azimut.engine import mvt, pmtiles
from azimut.engine.buildings import model, overture

# A z14 tile over Taiz, where Overture's footprints are Microsoft's.
Z, X, Y = model.tile_of(13.578, 44.018)


def _tile_with(*features: tuple[tuple[int, int, int, int], dict]) -> bytes:
    layer = mvt.Layer("building")
    for (x0, y0, x1, y1), properties in features:
        layer.rectangles(np.array([x0]), np.array([y0]), np.array([x1]), np.array([y1]), properties)
    return mvt.encode([layer])


def _sources(provider: str, **when: str) -> str:
    return json.dumps([{"provider": provider, **when}])


class FakeArchive:
    def __init__(self, body: bytes | None = None, error: Exception | None = None) -> None:
        self.body, self.error = body, error

    def tile(self, z: int, x: int, y: int) -> bytes | None:
        if self.error is not None:
            raise self.error
        return self.body


@pytest.fixture(autouse=True)
def no_release(monkeypatch):
    monkeypatch.setattr(overture, "_archive", None)


def test_heights_say_whose_they_are_and_a_floor_count_is_an_estimate(monkeypatch) -> None:
    body = _tile_with(
        ((100, 100, 300, 300), {"height": 18.1, "@height_source": "OpenStreetMap",
                                 "sources": _sources("osm", update_time="2026-06-22T08:15:16.000Z")}),
        ((400, 100, 600, 300), {"height": 9.0, "@height_source": "Esri Community Maps", "sources": "[]"}),
        ((700, 100, 900, 300), {"num_floors": 4, "sources": _sources("microsoft", version="2026-08-11")}),
        ((1000, 100, 1200, 300), {"sources": _sources("google", update_time="2023-05-01T00:00:00Z")}),
        ((1300, 100, 1500, 300), {"is_underground": True, "height": 3.0}),
    )
    monkeypatch.setattr(overture, "_open", lambda: FakeArchive(body))
    got = [(b.height, b.kind, b.date) for b in overture.fetch_tile(Z, X, Y)]
    assert got == [
        (18.1, "measured", "2026-06-22"),
        (9.0, "estimated", ""),
        (12.0, "estimated", "2026-08-11"),
        (None, "unknown", "2023-05-01"),
    ]


def test_the_newest_release_is_looked_up_in_the_catalog(monkeypatch) -> None:
    def answer(url, **_kwargs):
        assert url == overture.CATALOG
        return httpx.Response(200, json={"latest": "2026-09-23.1"}, request=httpx.Request("GET", url))

    opened = []
    monkeypatch.setattr(overture.httpx, "get", answer)
    monkeypatch.setattr(overture.pmtiles, "Archive", lambda url: opened.append(url) or FakeArchive(b""))
    overture._open()
    overture._open()
    assert opened == ["https://tiles.overturemaps.org/2026-09-23.1/buildings.pmtiles"]


@pytest.mark.parametrize("catalog", [{"latest": ""}, {"latest": "../x"}, {}])
def test_a_catalog_naming_no_release_is_unavailable(monkeypatch, catalog) -> None:
    monkeypatch.setattr(
        overture.httpx, "get",
        lambda url, **_k: httpx.Response(200, json=catalog, request=httpx.Request("GET", url)),
    )
    with pytest.raises(model.BuildingsUnavailable):
        overture.latest_release()


def test_a_release_taken_down_is_looked_up_again_on_the_next_read(monkeypatch) -> None:
    monkeypatch.setattr(overture, "_archive", FakeArchive(error=pmtiles.PMTilesUnavailable("HTTP 400")))
    monkeypatch.setattr(overture, "_release_at", 1e18)
    with pytest.raises(model.BuildingsUnavailable):
        overture.fetch_tile(Z, X, Y)
    assert overture._archive is None
