"""NRW's LoD2 buildings: ground faces as footprints, measured heights, and the server's paging quirks."""

from __future__ import annotations

import json
from urllib.parse import parse_qs, urlparse

import httpx
import pytest

from azimut.engine.buildings import model, nrw

# A z14 tile over Cologne, where the state's model is.
Z, X, Y = model.tile_of(50.9413, 6.9583)
SCALE = [1e-7, 1e-7, 0.001]
ORIGIN = [6.95, 50.94, 40.0]


def _vertex(lon: float, lat: float, height: float) -> list[int]:
    return [round((lon - ORIGIN[0]) / SCALE[0]), round((lat - ORIGIN[1]) / SCALE[1]), round((height - ORIGIN[2]) / SCALE[2])]


def _box_part(lon: float, lat: float, top: float, *, measured: float | None = 12.5) -> tuple[dict, list[list[int]]]:
    """A box-shaped part about 8 m by 5 m standing on 50 m ground: its CityObject and its vertices,
    numbered from 0 within the feature."""
    d = 0.00007
    corners = [(lon, lat), (lon + d, lat), (lon + d, lat + d), (lon, lat + d)]
    vertices = [_vertex(x, y, 50.0) for x, y in corners] + [_vertex(x, y, 50.0 + top) for x, y in corners]
    ground = [[0, 3, 2, 1]]
    roof = [[4, 5, 6, 7]]
    walls = [[[i, (i + 1) % 4, 4 + (i + 1) % 4, 4 + i]] for i in range(4)]
    attributes = {"creationDate": "2026-01-24", "roofType": "1000"}
    if measured is not None:
        attributes["measuredHeight"] = measured
    part = {
        "type": "BuildingPart",
        "parents": ["b"],
        "attributes": attributes,
        "geometry": [{
            "type": "Solid", "lod": "2",
            "boundaries": [[ground, roof, *walls]],
            "semantics": {
                "surfaces": [{"type": "GroundSurface"}, {"type": "RoofSurface"}, {"type": "WallSurface"}],
                "values": [[0, 1, 2, 2, 2, 2]],
            },
        }],
    }
    return part, vertices


def _feature(*parts: tuple[dict, list[list[int]]]) -> dict:
    objects: dict = {"b": {"type": "Building", "children": [], "attributes": {}}}
    vertices: list[list[int]] = []
    for n, (part, verts) in enumerate(parts):
        offset = len(vertices)
        shell = part["geometry"][0]["boundaries"][0]
        part["geometry"][0]["boundaries"] = [[[[i + offset for i in ring] for ring in face] for face in shell]]
        objects[f"p{n}"] = part
        objects["b"]["children"].append(f"p{n}")
        vertices += verts
    return {"type": "CityJSONFeature", "CityObjects": objects, "vertices": vertices}


def _sequence(*features: dict, cut: bool = False) -> bytes:
    header = {"type": "CityJSON", "version": "1.1", "transform": {"scale": SCALE, "translate": ORIGIN}}
    lines = [json.dumps(header)] + [json.dumps(f) for f in features]
    if cut:
        lines[-1] = lines[-1][: len(lines[-1]) // 2]
    return ("\n".join(lines) + "\n").encode()


def test_a_part_stands_on_its_ground_face_with_its_measured_height() -> None:
    (document,) = nrw.read_sequence(_sequence(_feature(_box_part(6.9500, 50.9400, 15.0))))
    (building,) = nrw.read_cityjson(document)
    assert building.height == 12.5 and building.kind == "measured" and building.source == "nrw"
    assert building.date == "2026-01-24"
    lon, lat = building.rings[0][0]
    assert lon == pytest.approx(6.95) and lat == pytest.approx(50.94)
    assert len(building.rings[0]) == 4 and 30 < model.footprint_area(building) < 45


def test_without_a_measured_height_the_solid_says_how_tall_it_stands() -> None:
    (document,) = nrw.read_sequence(_sequence(_feature(_box_part(6.95, 50.94, 21.0, measured=None))))
    (building,) = nrw.read_cityjson(document)
    assert building.height == pytest.approx(21.0)


def test_a_line_cut_short_ends_the_sequence_there() -> None:
    body = _sequence(_feature(_box_part(6.95, 50.94, 9.0)), _feature(_box_part(6.951, 50.94, 9.0)), cut=True)
    assert len(nrw.read_sequence(body)) == 1


def test_anything_but_cityjson_is_unavailable() -> None:
    with pytest.raises(model.BuildingsUnavailable):
        nrw.read_sequence(b"<html>Bad Request</html>")


class FakeServer:
    """The state's server: `total` buildings, a page cut short before each of `broken` unless
    it heads the page, before each of `never` even then, and a 400 for a page past the end."""

    def __init__(self, total: int, broken: set[int], never: frozenset[int] = frozenset()) -> None:
        self.total = total
        self.broken = broken | never
        self.never = never
        self.asked: list[int] = []

    def get(self, url: str) -> httpx.Response:
        query = parse_qs(urlparse(url).query)
        offset, limit = int(query["offset"][0]), int(query["limit"][0])
        assert query["f"] == ["cityjsonseq"] and "bbox" in query
        self.asked.append(offset)
        request = httpx.Request("GET", url)
        if offset > self.total or offset in self.never:
            return httpx.Response(400, content=b"Bad Request", request=request)
        features = []
        for n in range(offset, min(offset + limit, self.total)):
            if n in self.broken and (n != offset or n in self.never):
                break
            features.append(_feature(_box_part(6.95 + n * 0.0002, 50.94, 9.0)))
        return httpx.Response(200, content=_sequence(*features), request=request)


def test_a_page_cut_short_is_read_on_from_the_building_it_stopped_before(monkeypatch) -> None:
    server = FakeServer(total=7, broken={4})
    monkeypatch.setattr(nrw, "PAGE", 3)
    monkeypatch.setattr(nrw, "_client", lambda: server)
    buildings = nrw.fetch_tile(Z, X, Y)
    # 0-2; 3 then a stop before 4; 4-6 with 4 at the head; then nothing more
    assert server.asked == [0, 3, 4, 7]
    assert len(buildings) == 7


def test_a_building_never_written_is_stepped_over_and_a_page_past_the_end_ends_it(monkeypatch) -> None:
    server = FakeServer(total=7, broken=set(), never=frozenset({4}))
    monkeypatch.setattr(nrw, "PAGE", 3)
    monkeypatch.setattr(nrw, "_client", lambda: server)
    buildings = nrw.fetch_tile(Z, X, Y)
    # 0-2; 3 then a stop; a page from 4 is refused, so 5 onward; 7 is empty, 8 refused
    assert server.asked == [0, 3, 4, 5, 7, 8]
    assert len(buildings) == 6


def test_coverage_is_the_state_and_its_edges() -> None:
    assert nrw.covers(*model.tile_of(51.2277, 6.7735))  # Düsseldorf
    assert not nrw.covers(*model.tile_of(48.137, 11.575))  # Munich
