"""New York's footprints: heights in feet, the ones the survey left out, paging and failures."""

from __future__ import annotations

import json

import httpx
import pytest

from azimut.engine.buildings import model, nyc

Z, X, Y = model.tile_of(40.7484, -73.9857)


def _feature(lon: float, lat: float, feet: str | None, edited: str = "2017-08-22T18:30:09.000") -> dict:
    d = 0.0002
    ring = [[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]
    return {
        "type": "Feature",
        "geometry": {"type": "MultiPolygon", "coordinates": [[ring]]},
        "properties": {"height_roof": feet, "last_edited_date": edited},
    }


class FakeCity:
    def __init__(self, features: list[dict], status: int = 200) -> None:
        self.features = features
        self.status = status
        self.asked: list[dict] = []

    def get(self, url: str, params: dict) -> httpx.Response:
        self.asked.append(params)
        start, limit = int(params["$offset"]), int(params["$limit"])
        body = json.dumps({"type": "FeatureCollection", "features": self.features[start:start + limit]})
        return httpx.Response(self.status, content=body.encode(), request=httpx.Request("GET", url))


def test_heights_come_in_feet_and_a_tower_is_not_taken_for_a_mistake(monkeypatch) -> None:
    city = FakeCity([_feature(-73.9857, 40.7484, "1238.79"), _feature(-73.99, 40.75, "40")])
    monkeypatch.setattr(nyc, "_client", lambda: city)
    tower, house = nyc.fetch_tile(Z, X, Y)
    assert tower.height == pytest.approx(377.58, abs=0.01) and tower.kind == "measured"
    assert house.height == pytest.approx(12.19, abs=0.01)
    assert tower.source == "nyc" and tower.date == "2017-08-22"
    assert "within_box(the_geom" in city.asked[0]["$where"]


@pytest.mark.parametrize("feet", ["0", None, "x"])
def test_a_footprint_without_a_surveyed_height_is_unknown(monkeypatch, feet) -> None:
    monkeypatch.setattr(nyc, "_client", lambda: FakeCity([_feature(-73.9857, 40.7484, feet)]))
    (building,) = nyc.fetch_tile(Z, X, Y)
    assert building.height is None and building.kind == "unknown"


def test_a_full_page_is_followed_by_the_next(monkeypatch) -> None:
    city = FakeCity([_feature(-73.98 - i * 0.0003, 40.75, "30") for i in range(5)])
    monkeypatch.setattr(nyc, "PAGE", 2)
    monkeypatch.setattr(nyc, "_client", lambda: city)
    assert len(nyc.fetch_tile(Z, X, Y)) == 5
    assert [p["$offset"] for p in city.asked] == ["0", "2", "4"]


def test_a_refusal_is_said(monkeypatch) -> None:
    monkeypatch.setattr(nyc, "_client", lambda: FakeCity([], status=403))
    with pytest.raises(model.BuildingsUnavailable, match="403"):
        nyc.fetch_tile(Z, X, Y)


def test_coverage_is_the_five_boroughs() -> None:
    assert nyc.covers(Z, X, Y)
    assert nyc.covers(*model.tile_of(40.58, -74.15))  # Staten Island
    assert not nyc.covers(*model.tile_of(42.36, -71.06))  # Boston
