"""The IGN's BD TOPO buildings: the request, the paging, the heights, the coverage."""

from __future__ import annotations

import json
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest

from azimut.engine import tiles
from azimut.engine.buildings import ign, model
from azimut.engine.buildings.model import BuildingsUnavailable

LYON = (45.7578, 4.8320)
Z, X, Y = model.tile_of(*LYON, model.ZOOM)


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    """Any request that is not answered by a test's own fake fails the test."""

    def refuse():
        raise AssertionError("a test reached the network")

    monkeypatch.setattr(ign, "_client", refuse)
    monkeypatch.setattr(tiles, "RETRY_PAUSE", 0.0)


def _square(lon: float, lat: float, side_lon: float = 0.0002, side_lat: float = 0.0002):
    """A closed square ring, as GeoJSON writes it, with a height on every point."""
    corners = [
        (lon, lat), (lon + side_lon, lat), (lon + side_lon, lat + side_lat), (lon, lat + side_lat),
    ]
    return [[px, py, 180.0] for px, py in corners] + [[lon, lat, 180.0]]


def _feature(geometry_type="MultiPolygon", coordinates=None, **props):
    """A WFS feature. Default: one square footprint, as a MultiPolygon or a Polygon."""
    if coordinates is None:
        square = _square(4.8320, 45.7578)
        coordinates = [[square]] if geometry_type == "MultiPolygon" else [square]
    return {
        "type": "Feature",
        "id": "batiment.1",
        "geometry": {"type": geometry_type, "coordinates": coordinates},
        "geometry_name": "geometrie",
        "properties": {"etat_de_l_objet": "En service", **props},
    }


def _page(features, matched=None):
    data = {"type": "FeatureCollection", "features": features}
    if matched is not None:
        data["numberMatched"] = matched
        data["numberReturned"] = len(features)
    return 200, json.dumps(data).encode()


def _serve(monkeypatch, *pages):
    """Answer each GET with the next page; returns the list of URLs asked."""
    asked = []
    answers = iter(pages)

    def get(url):
        asked.append(url)
        return next(answers)

    monkeypatch.setattr(ign, "_get", get)
    return asked


def test_a_page_becomes_one_building_per_polygon_with_holes_kept(monkeypatch):
    outer = _square(4.8320, 45.7578, 0.0004, 0.0004)
    hole = _square(4.83205, 45.75785, 0.00005, 0.00005)
    walled = _feature(hauteur=12.5, date_modification="2022-08-10T10:00:00Z", coordinates=[[outer, hole]])
    tower = _square(4.8330, 45.7580)
    flat = _feature("Polygon", coordinates=[tower], hauteur=None, date_creation="2006-08-18T10:13:50.587Z")
    _serve(monkeypatch, _page([walled, flat], matched=2))

    first, second = ign.fetch_tile(Z, X, Y)

    assert len(first.rings) == 2  # the outer ring, then the courtyard
    assert all(len(ring) == 4 for ring in first.rings)  # open rings: the repeated point is gone
    assert first.height == 12.5 and first.kind == "measured"
    assert first.date == "2022-08-10" and first.source == "ign" and first.min_height == 0.0
    assert len(second.rings) == 1
    assert second.height is None and second.kind == "unknown"
    assert second.date == "2006-08-18"


@pytest.mark.parametrize(
    ("hauteur", "height", "kind"),
    [
        (9.0, 9.0, "measured"),
        ("12.5", 12.5, "measured"),
        (0, None, "unknown"),
        (-3.0, None, "unknown"),
        (1200.0, None, "unknown"),
        ("n/a", None, "unknown"),
        (None, None, "unknown"),
    ],
)
def test_a_height_is_measured_only_when_the_ign_gives_a_usable_one(monkeypatch, hauteur, height, kind):
    _serve(monkeypatch, _page([_feature(hauteur=hauteur)], matched=1))
    (building,) = ign.fetch_tile(Z, X, Y)
    assert building.height == height
    assert building.kind == kind


@pytest.mark.parametrize(
    ("props", "date"),
    [
        ({"date_modification": "2022-08-10T00:00:00Z", "date_creation": "2006-01-01T00:00:00Z"}, "2022-08-10"),
        ({"date_modification": None, "date_creation": "2006-08-18T10:13:50.587Z"}, "2006-08-18"),
        ({"date_creation": "2006-08-18T10:13:50.587Z"}, "2006-08-18"),
        ({}, ""),
    ],
)
def test_the_date_is_the_last_modification_else_the_creation_as_a_day(monkeypatch, props, date):
    _serve(monkeypatch, _page([_feature(hauteur=5.0, **props)], matched=1))
    (building,) = ign.fetch_tile(Z, X, Y)
    assert building.date == date


@pytest.mark.parametrize("state", ["En projet", " En projet "])
def test_a_planned_building_is_skipped(monkeypatch, state):
    _serve(monkeypatch, _page([_feature(etat_de_l_objet=state, hauteur=20.0)], matched=1))
    assert ign.fetch_tile(Z, X, Y) == []


@pytest.mark.parametrize("state", ["En service", "Ruine", "En construction"])
def test_a_standing_ruined_or_rising_building_is_kept(monkeypatch, state):
    _serve(monkeypatch, _page([_feature(etat_de_l_objet=state, hauteur=20.0)], matched=1))
    assert len(ign.fetch_tile(Z, X, Y)) == 1


def test_a_footprint_under_the_minimum_area_is_dropped(monkeypatch):
    # about 1.6 m by 2.2 m: under MIN_AREA (6 m²)
    shed = _feature("Polygon", coordinates=[_square(4.8320, 45.7578, 0.00002, 0.00002)], hauteur=3.0)
    _serve(monkeypatch, _page([shed], matched=1))
    assert ign.fetch_tile(Z, X, Y) == []


def test_paging_asks_again_from_where_the_last_page_stopped(monkeypatch):
    full = [_feature(hauteur=6.0) for _ in range(ign.PAGE)]
    rest = [_feature(hauteur=7.0) for _ in range(3)]
    asked = _serve(monkeypatch, _page(full, matched=ign.PAGE + 3), _page(rest, matched=ign.PAGE + 3))

    buildings = ign.fetch_tile(Z, X, Y)

    assert len(asked) == 2
    assert len(buildings) == ign.PAGE + 3
    query = parse_qs(urlsplit(asked[1]).query)
    assert query["STARTINDEX"] == [str(ign.PAGE)]
    assert query["COUNT"] == [str(ign.PAGE)]


def test_a_short_page_ends_the_paging_when_no_count_is_given(monkeypatch):
    full = [_feature(hauteur=6.0) for _ in range(ign.PAGE)]
    asked = _serve(monkeypatch, _page(full), _page([_feature(hauteur=7.0)]))
    assert len(ign.fetch_tile(Z, X, Y)) == ign.PAGE + 1
    assert len(asked) == 2


def test_the_request_names_the_box_latitude_first_and_only_the_fields_needed(monkeypatch):
    asked = _serve(monkeypatch, _page([], matched=0))
    ign.fetch_tile(Z, X, Y)
    (url,) = asked
    query = parse_qs(urlsplit(url).query)
    west, south, east, north = model.tile_bounds(Z, X, Y)
    assert query["BBOX"] == [f"{south},{west},{north},{east},urn:ogc:def:crs:EPSG::4326"]
    assert query["TYPENAMES"] == ["BDTOPO_V3:batiment"]
    assert query["SORTBY"] == ["cleabs"]
    assert query["PROPERTYNAME"] == [",".join(ign.PROPERTIES)]
    assert "geometrie" in query["PROPERTYNAME"][0].split(",")


def test_a_transient_status_is_asked_again(monkeypatch):
    calls = []

    def handler(request):
        calls.append(request.url)
        if len(calls) == 1:
            return httpx.Response(503)
        return httpx.Response(200, json={"features": [_feature(hauteur=4.0)], "numberMatched": 1})

    monkeypatch.setattr(ign, "_client", lambda: httpx.Client(transport=httpx.MockTransport(handler)))

    buildings = ign.fetch_tile(Z, X, Y)

    assert len(calls) == 2
    assert [b.height for b in buildings] == [4.0]


def test_a_server_error_is_unavailable_and_not_retried(monkeypatch):
    calls = []

    def handler(request):
        calls.append(request.url)
        return httpx.Response(500)

    monkeypatch.setattr(ign, "_client", lambda: httpx.Client(transport=httpx.MockTransport(handler)))

    with pytest.raises(BuildingsUnavailable) as caught:
        ign.fetch_tile(Z, X, Y)
    assert str(caught.value) == "The IGN's buildings could not be read just now (the IGN answered 500)"
    assert len(calls) == 1


def test_a_gateway_that_never_answers_is_unavailable_after_the_tries(monkeypatch):
    calls = []

    def handler(request):
        calls.append(request.url)
        raise httpx.ConnectError("refused", request=request)

    monkeypatch.setattr(ign, "_client", lambda: httpx.Client(transport=httpx.MockTransport(handler)))

    with pytest.raises(BuildingsUnavailable, match=r"^The IGN's buildings could not be read just now \("):
        ign.fetch_tile(Z, X, Y)
    assert len(calls) == tiles.MAX_TILE_TRIES


def test_a_reply_that_is_not_geojson_is_unavailable(monkeypatch):
    _serve(monkeypatch, (200, b"<html>maintenance</html>"))
    with pytest.raises(BuildingsUnavailable, match="something other than GeoJSON"):
        ign.fetch_tile(Z, X, Y)


def test_only_zoom_fourteen_is_read(monkeypatch):
    _serve(monkeypatch)  # any request would run out of answers and fail
    with pytest.raises(ValueError):
        ign.fetch_tile(13, X // 2, Y // 2)


@pytest.mark.parametrize(
    "point",
    [
        (48.8566, 2.3522),  # Paris
        (45.7578, 4.8320),  # Lyon
        (47.9030, 1.9093),  # Orléans
        (47.3941, 0.6848),  # Tours
        (47.0810, 2.3988),  # Bourges
        (48.2973, 4.0744),  # Troyes
        (45.7772, 3.0870),  # Clermont-Ferrand
        (45.8336, 1.2611),  # Limoges
        (46.5802, 0.3404),  # Poitiers
        (48.3904, -4.4861),  # Brest
        (49.6337, -1.6222),  # Cherbourg
        (51.0344, 2.3768),  # Dunkerque
        (50.6292, 3.0573),  # Lille
        (48.5734, 7.7521),  # Strasbourg
        (47.7508, 7.3359),  # Mulhouse
        (49.1193, 6.1757),  # Metz
        (47.3220, 5.0415),  # Dijon
        (45.9237, 6.8694),  # Chamonix
        (43.7102, 7.2620),  # Nice
        (43.2965, 5.3698),  # Marseille
        (42.6887, 2.8948),  # Perpignan
        (43.4832, -1.5586),  # Biarritz
        (44.8378, -0.5792),  # Bordeaux
        (43.6047, 1.4442),  # Toulouse
        (46.1591, -1.1520),  # La Rochelle
        (41.9192, 8.7386),  # Ajaccio
        (42.6973, 9.4509),  # Bastia
        (-20.8789, 55.4481),  # Saint-Denis, La Réunion
        (4.9333, -52.3333),  # Cayenne, Guyane
    ],
)
def test_the_coverage_includes_french_ground(point):
    z, x, y = model.tile_of(*point, model.ZOOM)
    assert ign.covers(z, x, y)


@pytest.mark.parametrize(
    "point",
    [
        (40.4168, -3.7038),  # Madrid
        (52.5200, 13.4050),  # Berlin
        (40.7128, -74.0060),  # New York
        (13.5795, 44.0209),  # Taiz
    ],
)
def test_the_coverage_leaves_out_the_rest_of_the_world(point):
    z, x, y = model.tile_of(*point, model.ZOOM)
    assert not ign.covers(z, x, y)
