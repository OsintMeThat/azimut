"""FIRMS detections from the area API's points, close in.

The plan (which cells, which days, how few requests), the reading of an answer,
the vector tiles the map draws and the extension's picture are pure and tested
without NASA; a tile is read back with ``mvtread``, written from the
specification apart from the encoder. The route tests put FIRMS behind a fake
transport, as ``test_firms.py`` does, and count what was asked: the whole point
is asking once for many tiles.
"""

from __future__ import annotations

import io
import math
import threading
from datetime import date, datetime, timedelta, timezone

import httpx
import numpy as np
import pytest
from PIL import Image

from azimut.engine import firms, firmspoints
from mvtread import read, ring_area

NOW = datetime(2026, 9, 27, 11, 40, tzinfo=timezone.utc)
HEADER = "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight"
MODIS_HEADER = "latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight"
UNKNOWN_KEY = "MAP_KEY is invalid or your have exceeded your transaction/time limit. Please try again later."


def _tile(lat: float, lon: float, z: int) -> tuple[int, int]:
    n = 1 << z
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return x, y


def _row(lat: float, lon: float, seen: datetime, scan: float = 0.4, track: float = 0.4) -> str:
    return f"{lat},{lon},330.1,{scan},{track},{seen:%Y-%m-%d},{seen:%H%M},N20,VIIRS,n,2.0NRT,290.5,3.2,D"


def _pixels(content: bytes):
    with Image.open(io.BytesIO(content)) as image:
        return np.asarray(image.convert("RGBA"))


def _points(*rows: tuple[float, float, datetime, float, float]) -> firmspoints.Points:
    lat, lon, seen, scan, track = zip(*rows, strict=True)
    return firmspoints.Points(
        np.array(lon, dtype=np.float32), np.array(lat, dtype=np.float32),
        np.array(scan, dtype=np.float32), np.array(track, dtype=np.float32),
        np.array([int(s.timestamp()) for s in seen], dtype=np.int64),
    )


def _at(bounds, width, lat, lon) -> tuple[int, int]:
    """Where a point lands in a picture, as (row, column)."""
    left, bottom, right, top = bounds
    x, y = firms.mercator(lat, lon)
    return int((top - y) / (top - bottom) * width), int((x - left) / (right - left) * width)


# -- which pictures, which cells, which days -----------------------------------


def test_a_close_tile_of_a_live_window_is_drawn_here():
    x, y = _tile(48.95, 37.8, firmspoints.MIN_ZOOM)
    close = firms.tile_bounds(firmspoints.MIN_ZOOM, x, y)
    assert firmspoints.drawn_here("7d", close, firms.TILE_SIZE)
    assert firmspoints.drawn_here("24h", firms.tile_bounds(13, *_tile(48.95, 37.8, 13)), firms.TILE_SIZE)


def test_a_far_tile_or_a_dated_range_stays_with_the_wms():
    far = firms.tile_bounds(firmspoints.MIN_ZOOM - 1, *_tile(48.95, 37.8, firmspoints.MIN_ZOOM - 1))
    assert not firmspoints.drawn_here("7d", far, firms.TILE_SIZE)
    close = firms.tile_bounds(10, *_tile(48.95, 37.8, 10))
    assert not firmspoints.drawn_here("dates", close, firms.TILE_SIZE)


def test_a_picture_over_too_many_cells_stays_with_the_wms():
    # fine enough pixels, but a very wide picture: the extension's biggest
    wide = firms.bounds_of(40, 20, 52, 45)
    assert not firmspoints.drawn_here("24h", wide, 20_000)


def test_a_tile_draws_from_the_cells_it_touches_and_a_pixel_s_reach_past_them():
    inside = firms.bounds_of(-6.5, 29.2, -6.0, 29.7)
    assert firmspoints.cells_for(inside) == [(7, -2)]
    across = firms.bounds_of(-6.5, 31.8, -6.0, 32.3)
    assert firmspoints.cells_for(across) == [(7, -2), (8, -2)]
    # a MODIS pixel centred just across the line still reaches in
    near = firms.bounds_of(-6.5, 31.5, -6.0, 31.99)
    assert firmspoints.cells_for(near) == [(7, -2), (8, -2)]


def test_a_cell_is_asked_as_west_south_east_north():
    assert firmspoints.cell_box((7, -2)) == "28,-8,32,-4"
    assert firmspoints.cell_box((44, 22)) == "176,88,180,90"


def test_a_rolling_window_is_whole_utc_days_as_firms_counts_them():
    # matched pixel for pixel against the WMS layers, 2026-09-27: "24 h" held
    # the previous day's main pass, 25 hours old, and nothing of the day before
    assert firmspoints.days_for("24h", NOW) == [date(2026, 9, 26), date(2026, 9, 27)]
    assert firmspoints.days_for("48h", NOW)[0] == date(2026, 9, 25)
    assert firmspoints.days_for("72h", NOW)[0] == date(2026, 9, 24)
    week = firmspoints.days_for("7d", NOW)
    assert week[0] == date(2026, 9, 20) and week[-1] == date(2026, 9, 27) and len(week) == 8
    assert firmspoints.since("24h", NOW) == int(datetime(2026, 9, 26, tzinfo=timezone.utc).timestamp())
    # a minute past midnight it is still yesterday and today, not one minute of either
    late = datetime(2026, 9, 27, 0, 1, tzinfo=timezone.utc)
    assert firmspoints.days_for("24h", late) == [date(2026, 9, 26), date(2026, 9, 27)]


def test_days_are_asked_in_the_fewest_requests_and_five_at_most():
    week = firmspoints.days_for("7d", NOW)
    assert firmspoints.runs(week) == [(date(2026, 9, 20), 5), (date(2026, 9, 25), 3)]
    gap = [date(2026, 9, 20), date(2026, 9, 21), date(2026, 9, 24), date(2026, 9, 24)]
    assert firmspoints.runs(gap) == [(date(2026, 9, 20), 2), (date(2026, 9, 24), 1)]
    assert firmspoints.runs([]) == []


def test_a_request_names_the_source_the_box_the_days_and_the_first_day():
    url = firmspoints.area_url("KEY", "VIIRS_SNPP_NRT", (7, -2), date(2026, 9, 20), 5)
    assert url == f"{firmspoints.AREA_BASE}/KEY/VIIRS_SNPP_NRT/28,-8,32,-4/5/2026-09-20"


def test_the_combined_viirs_layer_is_its_three_satellites():
    assert firmspoints.SOURCES["viirs"] == ("VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT")
    assert set(firmspoints.SOURCES) == {s.id for s in firms.SENSORS}


def test_a_day_still_being_filed_is_kept_minutes_and_an_older_one_hours():
    assert firmspoints.fresh_seconds(date(2026, 9, 27), NOW) == firms.LIVE_CACHE_SECONDS
    assert firmspoints.fresh_seconds(date(2026, 9, 26), NOW) == firms.LIVE_CACHE_SECONDS
    assert firmspoints.fresh_seconds(date(2026, 9, 25), NOW) == firms.PAST_CACHE_SECONDS


# -- reading an answer -----------------------------------------------------------


def test_an_answer_is_filed_by_day_with_every_day_asked_present():
    seen = datetime(2026, 9, 21, 12, 12, tzinfo=timezone.utc)
    text = "\n".join([HEADER, _row(-6.99, 29.71, seen, 0.36, 0.57), "garbage,row", ""])
    found = firmspoints.parse(text, [date(2026, 9, 20), date(2026, 9, 21)])
    assert set(found) == {date(2026, 9, 20), date(2026, 9, 21)}
    # a day with no row is a day with no fires, held as that
    assert len(found[date(2026, 9, 20)]) == 0
    day = found[date(2026, 9, 21)]
    assert len(day) == 1
    assert day.lat[0] == pytest.approx(-6.99) and day.lon[0] == pytest.approx(29.71)
    assert day.scan[0] == pytest.approx(0.36) and day.track[0] == pytest.approx(0.57)
    assert day.seen[0] == int(seen.timestamp())


def test_modis_is_read_by_its_own_header():
    seen = datetime(2026, 9, 25, 0, 5, tzinfo=timezone.utc)
    row = f"-6.94,29.48,324.8,1.23,1.1,{seen:%Y-%m-%d},0005,Aqua,MODIS,77,6.1NRT,297.5,18.4,N"
    found = firmspoints.parse(f"{MODIS_HEADER}\n{row}\n", [date(2026, 9, 25)])
    assert found[date(2026, 9, 25)].seen[0] == int(seen.timestamp())


def test_a_sentence_is_not_a_table():
    assert not firmspoints.is_table("Invalid MAP_KEY.")
    with pytest.raises(ValueError):
        firmspoints.parse("Invalid MAP_KEY.", [date(2026, 9, 25)])


# -- the drawing ------------------------------------------------------------------


def test_far_in_a_detection_is_a_solid_square_red_or_amber_with_a_ring():
    z = firmspoints.MIN_ZOOM
    bounds = firms.tile_bounds(z, *_tile(-6.3, 29.4, z))
    recent = (-6.3, 29.4, NOW - timedelta(hours=2), 0.4, 0.4)
    earlier = (-6.2, 29.3, NOW - timedelta(days=3), 0.4, 0.4)
    gone = (-6.4, 29.5, NOW - timedelta(days=9), 0.4, 0.4)
    image = _pixels(firmspoints.render(_points(recent, earlier, gone), bounds, 512, 512,
                                       sensor_id="viirs", window="7d", now=NOW))
    row, col = _at(bounds, 512, -6.3, 29.4)
    assert tuple(image[row, col]) == (*firms.RECENT_RGB, 255)
    row2, col2 = _at(bounds, 512, -6.2, 29.3)
    assert tuple(image[row2, col2]) == (*firms.EARLIER_RGB, 255)
    # the ring, just past the square
    half = firms.mark_px("viirs", bounds, 512) // 2
    assert image[row, col + half + 1][3] > 150 and image[row, col + half + 1][0] < 80
    # older than the window: not drawn
    row3, col3 = _at(bounds, 512, -6.4, 29.5)
    assert image[row3, col3][3] == 0


def test_a_24_hour_window_draws_yesterday_and_today_as_firms_does():
    # the regression: counted by the hour, yesterday's main pass fell out of
    # "24 h" before today's was filed, and squares vanished past z8
    z = 9
    bounds = firms.tile_bounds(z, *_tile(-6.3, 29.4, z))
    yesterday = (-6.3, 29.4, NOW - timedelta(hours=25), 0.4, 0.4)
    before = (-6.25, 29.35, NOW - timedelta(days=2), 0.4, 0.4)
    image = _pixels(firmspoints.render(_points(yesterday, before), bounds, 512, 512,
                                       sensor_id="viirs", window="24h", now=NOW))
    row, col = _at(bounds, 512, -6.3, 29.4)
    assert tuple(image[row, col]) == (*firms.RECENT_RGB, 255)
    row, col = _at(bounds, 512, -6.25, 29.35)
    assert image[row, col][3] == 0


def test_a_square_across_a_tile_s_edge_is_drawn_on_both_tiles():
    z = 9
    x, y = _tile(-6.3, 29.4, z)
    left, bottom, right, top = firms.tile_bounds(z, x, y)
    lon, lat = firmspoints._degrees(right, (bottom + top) / 2)
    point = _points((lat, lon - 1e-4, NOW - timedelta(hours=1), 0.4, 0.4))
    here = _pixels(firmspoints.render(point, (left, bottom, right, top), 512, 512, sensor_id="viirs", window="24h", now=NOW))
    there = _pixels(firmspoints.render(point, firms.tile_bounds(z, x + 1, y), 512, 512,
                                       sensor_id="viirs", window="24h", now=NOW))
    assert here[256, 511][3] == 255 and there[256, 0][3] == 255


def test_close_in_every_footprint_keeps_its_own_edge_under_another():
    # The regression: the WMS picture has pixels, not squares, so an edge went
    # round the whole patch and the squares inside it lost theirs.
    z = 13
    bounds = firms.tile_bounds(z, *_tile(-6.3, 29.4, z))
    left, bottom, right, top = bounds
    lower_lon, lat = firmspoints._degrees((left + right) / 2, (bottom + top) / 2)
    upper_lon, _ = firmspoints._degrees((left + right) / 2 + 250, (bottom + top) / 2)  # half a pixel east
    lower = (lat, lower_lon, NOW - timedelta(days=2), 0.5, 0.5)
    upper = (lat, upper_lon, NOW - timedelta(hours=1), 0.5, 0.5)
    image = _pixels(firmspoints.render(_points(lower, upper), bounds, 512, 512, sensor_id="viirs", window="7d", now=NOW))
    assert firms.mark_px("viirs", bounds, 512) >= firms.FOOTPRINT_PX
    row, centre = _at(bounds, 512, lat, lower_lon)
    # across the pair, four solid edges: each square's two, the lower one's east
    # edge still there under the upper one, which the WMS picture lost
    solid = image[row, :, 3] == 255
    edges = [c for c in range(1, 512) if solid[c] and not solid[c - 1]]
    assert len(edges) == 4
    assert tuple(image[row, edges[1]][:3]) == firms.RECENT_RGB
    assert image[row, edges[2]][3] == 255 and tuple(image[row, edges[2]][:3]) != firms.RECENT_RGB
    # and the ground shows inside a footprint where no edge crosses it
    assert image[row, (edges[0] + edges[1]) // 2][3] < 160


def test_close_in_a_footprint_is_the_pixel_firms_measured():
    z = 13
    bounds = firms.tile_bounds(z, *_tile(-6.3, 29.4, z))
    left, bottom, right, top = bounds
    lon, lat = firmspoints._degrees((left + right) / 2, (bottom + top) / 2)
    wide = _points((lat, lon, NOW - timedelta(hours=1), 0.8, 0.4))
    image = _pixels(firmspoints.render(wide, bounds, 512, 512, sensor_id="viirs", window="24h", now=NOW))
    rows, cols = np.nonzero(image[..., 3])
    assert (cols.max() - cols.min()) / (rows.max() - rows.min()) == pytest.approx(2, rel=0.15)


# -- the vector tiles the map draws ---------------------------------------------------


def _week_around(lat: float, lon: float, n: int = 40, spread: float = 0.2) -> firmspoints.Points:
    """Detections scattered around a place over the last week, a few of them recent."""
    rng = np.random.default_rng(7)
    rows = []
    for i in range(n):
        seen = NOW - timedelta(hours=float(rng.uniform(1, 160)))
        scan, track = float(rng.uniform(0.35, 0.8)), float(rng.uniform(0.35, 0.7))
        rows.append((lat + float(rng.uniform(-spread, spread)), lon + float(rng.uniform(-spread, spread)),
                     seen, scan, track))
    return _points(*rows)


def _marks(tile: bytes) -> list[tuple[int, int, dict]]:
    layer = read(tile).get("marks", {"features": []})
    return [(x, y, feature["properties"]) for feature in layer["features"] for [(x, y)] in feature["parts"]]


def test_a_tile_is_a_vector_tile_the_map_can_read():
    z = 9
    x, y = _tile(-6.3, 29.4, z)
    body = firmspoints.tile(_week_around(-6.3, 29.4), z, x, y, window="7d", now=NOW)
    layers = read(body)
    assert set(layers) == {"marks"}  # footprints only from FOOTPRINT_ZOOM
    assert layers["marks"]["extent"] == 4096 and layers["marks"]["version"] == 2
    # every feature is many points of one colour and one size
    for feature in layers["marks"]["features"]:
        assert feature["type"] == 1
        assert set(feature["properties"]) == {"recent", "side", "foot"}
        assert feature["properties"]["foot"] == 1
        assert feature["properties"]["side"] % firmspoints.SIZE_STEP_M == 0


def test_every_detection_is_one_mark_in_the_one_tile_its_centre_is_in():
    z = 10
    x, y = _tile(-6.3, 29.4, z)
    left, bottom, right, top = firms.tile_bounds(z, x, y)
    lon, lat = firmspoints._degrees((left + right) / 2, (bottom + top) / 2)
    points = _week_around(lat, lon, n=60, spread=0.4)
    seen = 0
    for dx in range(-2, 3):
        for dy in range(-2, 3):
            seen += len(_marks(firmspoints.tile(points, z, x + dx, y + dy, window="7d", now=NOW)))
    # the whole scatter fits in these 25 tiles, and no mark is drawn twice
    assert seen == 60


def test_a_mark_lands_where_its_detection_is_and_says_its_colour_and_size():
    z = 11
    x, y = _tile(-6.3, 29.4, z)
    left, bottom, right, top = bounds = firms.tile_bounds(z, x, y)
    lon, lat = firmspoints._degrees(left + (right - left) * 0.3, top - (top - bottom) * 0.6)
    recent = _points((lat, lon, NOW - timedelta(hours=26), 0.64, 0.36))
    [(mx, my, properties)] = _marks(firmspoints.tile(recent, z, x, y, window="7d", now=NOW))
    assert (mx, my) == (round(0.3 * 4096), round(0.6 * 4096))
    assert properties["recent"] == 1
    # the side of a square of the same area, stretched as Mercator stretches it
    side = math.sqrt(0.64 * 0.36) * 1000 / math.cos(math.radians(lat))
    assert abs(properties["side"] - side) <= firmspoints.SIZE_STEP_M / 2
    older = _points((lat, lon, NOW - timedelta(days=3), 0.64, 0.36))
    assert _marks(firmspoints.tile(older, z, x, y, window="7d", now=NOW))[0][2]["recent"] == 0
    assert bounds  # the same square the pictures use


def test_close_in_a_tile_carries_each_footprint_into_every_tile_it_reaches():
    z = firmspoints.FOOTPRINT_ZOOM
    x, y = _tile(-6.3, 29.4, z)
    left, bottom, right, top = firms.tile_bounds(z, x, y)
    # on the east border, so half of it lies in the next tile
    lon, lat = firmspoints._degrees(right, (bottom + top) / 2)
    point = _points((lat, lon - 1e-6, NOW - timedelta(hours=2), 0.5, 0.5))
    here = read(firmspoints.tile(point, z, x, y, window="24h", now=NOW))
    there = read(firmspoints.tile(point, z, x + 1, y, window="24h", now=NOW))
    [ring_here] = [ring for feature in here["footprints"]["features"] for ring in feature["parts"]]
    [ring_there] = [ring for feature in there["footprints"]["features"] for ring in feature["parts"]]
    # an outer ring each, clockwise on screen, reaching across the border
    assert ring_area(ring_here) > 0 and ring_area(ring_there) > 0
    assert max(px for px, _ in ring_here) > 4096 and min(px for px, _ in ring_there) < 0
    # the mark itself is in one tile only
    assert len(_marks(firmspoints.tile(point, z, x, y, window="24h", now=NOW))) == 1
    assert "marks" not in there
    # a footprint is scan by track: here as wide as it is tall
    xs, ys = [px for px, _ in ring_here], [py for _, py in ring_here]
    assert (max(xs) - min(xs)) == pytest.approx(max(ys) - min(ys), abs=2)


def test_a_tile_with_nothing_in_it_is_empty():
    assert firmspoints.tile(firmspoints.Points.empty(), 9, 300, 260, window="24h", now=NOW) == b""


# -- the route ----------------------------------------------------------------------


@pytest.fixture(autouse=True)
def a_fresh_firms_memory(monkeypatch):
    """No test inherits the points, the pause or the verdict of the one before."""
    from azimut.api import satellite

    monkeypatch.setattr(satellite, "_firms_verdict", None)
    monkeypatch.setattr(satellite, "_firms_rows", 0)
    satellite._firms_pause.clear()
    satellite._firms_points.clear()
    satellite._firms_flights.clear()
    yield
    satellite._firms_pause.clear()
    satellite._firms_points.clear()
    satellite._firms_flights.clear()


def _is_area(request: httpx.Request) -> bool:
    return str(request.url).startswith(firmspoints.AREA_BASE)


def _area_answer(rows: list[tuple[float, float, datetime]], source: str = ""):
    """An area API that answers each request with the rows of the days it asked,
    for every satellite or only the one named."""

    def answer(request: httpx.Request) -> httpx.Response:
        *_, count, start = str(request.url).split("/")
        first = date.fromisoformat(start)
        days = {first + timedelta(days=n) for n in range(int(count))}
        mine = not source or f"/{source}/" in str(request.url)
        body = [HEADER] + [_row(lat, lon, seen) for lat, lon, seen in rows if mine and seen.date() in days]
        return httpx.Response(200, text="\n".join(body) + "\n", headers={"content-type": "text/csv"})

    return answer


def _upstream(monkeypatch, handler):
    from azimut.api import satellite

    asked: list[httpx.Request] = []

    def record(request: httpx.Request) -> httpx.Response:
        asked.append(request)
        return handler(request)

    monkeypatch.setattr(satellite, "_tile_client", httpx.Client(transport=httpx.MockTransport(record)))
    return asked


LYMAN = (48.98, 37.80)


def _points_path(z: int, place=LYMAN) -> str:
    return f"/api/firms/points/{z}/{'/'.join(map(str, _tile(*place, z)))}"


def test_a_close_tile_is_cut_from_the_points_and_the_next_zooms_ask_nothing(client, monkeypatch):
    client.put("/api/settings/keys", json={"firms": "KEY123"})
    now = datetime.now(timezone.utc)
    asked = _upstream(monkeypatch, _area_answer([(*LYMAN, now - timedelta(minutes=5))], "VIIRS_NOAA20_NRT"))
    z = firmspoints.MIN_ZOOM
    answer = client.get(_points_path(z), params={"window": "24h"})
    assert answer.status_code == 200
    assert answer.headers["content-type"] == "application/vnd.mapbox-vector-tile"
    assert answer.headers["cache-control"] == f"private, max-age={firms.LIVE_CACHE_SECONDS}"
    assert b"KEY123" not in answer.content
    # one request per satellite for FIRMS's two days, all through the area API
    assert len(asked) == 3 and all(_is_area(request) for request in asked)
    assert all("/KEY123/" in str(request.url) and "/36,48,40,52/" in str(request.url) for request in asked)
    [(x, y, properties)] = _marks(answer.content)
    assert properties["recent"] == 1
    left, bottom, right, top = firms.tile_bounds(z, *_tile(*LYMAN, z))
    mx, my = firms.mercator(*LYMAN)
    assert (x, y) == (round((mx - left) / (right - left) * 4096), round((top - my) / (top - bottom) * 4096))
    # zooming in over the same cell is cut from what is held
    for deeper in range(z + 1, firmspoints.MAX_ZOOM + 1):
        assert client.get(_points_path(deeper), params={"window": "24h"}).status_code == 200
    assert len(asked) == 3


def test_tiles_come_for_the_zooms_the_map_asks_and_the_questions_firms_answers(client, monkeypatch):
    _upstream(monkeypatch, _never)
    # no key: nothing to ask with
    assert client.get(_points_path(9)).status_code == 404
    client.put("/api/settings/keys", json={"firms": "KEY123"})
    for path, params in [
        (_points_path(firmspoints.MAX_ZOOM + 1), {}),   # the map draws z13 bigger
        (_points_path(9), {"sensor": "landsat"}),
        (_points_path(9), {"window": "dates", "first": "2026-01-01", "last": "2026-06-01"}),  # too long
        ("/api/firms/points/9/600/0", {}),              # off the grid
    ]:
        assert client.get(path, params=params).status_code == 422, (path, params)


def _never(request: httpx.Request) -> httpx.Response:
    raise AssertionError(f"asked FIRMS for {request.url}")


def test_far_out_and_for_a_date_the_marks_come_off_firms_picture(client, monkeypatch):
    client.put("/api/settings/keys", json={"firms": "KEY123"})
    empty = io.BytesIO()
    Image.new("RGBA", (512, 512), (0, 0, 0, 0)).save(empty, "PNG")
    asked = _upstream(monkeypatch, lambda request: httpx.Response(
        200, content=empty.getvalue(), headers={"content-type": "image/png"}))
    far = client.get(_points_path(firmspoints.MIN_ZOOM - 1), params={"window": "24h"})
    dated = client.get(_points_path(10), params={"window": "dates", "first": "2026-09-01", "last": "2026-09-03"})
    for answer in (far, dated):
        assert answer.status_code == 200
        assert answer.headers["content-type"] == "application/vnd.mapbox-vector-tile"
        assert answer.content == b""  # nothing burning in the picture, nothing in the tile
    # one WMS picture each, and not a point asked of the area API
    assert len(asked) == 2 and all(str(r.url).startswith(firms.WMS_BASE) for r in asked)
    assert "TIME=2026-09-01/2026-09-03" in str(asked[1].url)


def test_a_picture_of_one_px_squares_becomes_one_mark_per_detection():
    # FIRMS spreads a square of one pixel over the pixels it straddles
    picture = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    picture.putpixel((201, 300), (*firms.EARLIER_RGB, 140))
    picture.putpixel((202, 300), (*firms.EARLIER_RGB, 140))
    picture.putpixel((40, 60), (*firms.RECENT_RGB, 255))
    picture.putpixel((41, 61), (*firms.RECENT_RGB, 60))  # a faint fringe does not count
    buffer = io.BytesIO()
    picture.save(buffer, "PNG")
    z, x, y = 5, 18, 12
    tile = read(firmspoints.picture_tile(buffer.getvalue(), z, x, y, sensor_id="viirs"))
    marks = sorted((mx, my, feature["properties"]["recent"]) for feature in tile["marks"]["features"]
                   for [(mx, my)] in feature["parts"])
    # the straddling pair is one amber mark at their middle, the red one where it is
    assert marks == [(40 * 8 + 4, 60 * 8 + 4, 1), (202 * 8, 300 * 8 + 4, 0)]
    # sized as the sensor's footprint: a picture does not say FIRMS's measured one
    [side] = {feature["properties"]["side"] for feature in tile["marks"]["features"]}
    left, bottom, right, top = firms.tile_bounds(z, x, y)
    _, lat = firmspoints._degrees((left + right) / 2, (bottom + top) / 2)
    assert abs(side - 375 / math.cos(math.radians(lat))) <= firmspoints.SIZE_STEP_M / 2


def test_close_in_a_picture_s_marks_hand_over_to_see_through_footprints():
    # a dated range comes off FIRMS's picture at every zoom, so close in it
    # needs footprints too, or its marks stay solid where a rolling window's fade
    picture = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    picture.putpixel((256, 256), (*firms.RECENT_RGB, 255))
    buffer = io.BytesIO()
    picture.save(buffer, "PNG")
    z = firmspoints.FOOTPRINT_ZOOM
    x, y = _tile(-6.3, 29.4, z)
    tile = read(firmspoints.picture_tile(buffer.getvalue(), z, x, y, sensor_id="viirs"))
    [mark] = tile["marks"]["features"]
    assert mark["properties"]["foot"] == 1
    [feature] = tile["footprints"]["features"]
    assert feature["properties"] == {"recent": 1}
    [ring] = feature["parts"]
    assert ring_area(ring) > 0
    # a square of the mark's side, centred on the mark
    left, _, right, _ = firms.tile_bounds(z, x, y)
    width = mark["properties"]["side"] * 4096 / (right - left)
    xs, ys = [px for px, _ in ring], [py for _, py in ring]
    assert max(xs) - min(xs) == pytest.approx(width, abs=2)
    assert max(ys) - min(ys) == pytest.approx(width, abs=2)
    [[(mx, my)]] = mark["parts"]
    assert (min(xs) + max(xs)) / 2 == pytest.approx(mx, abs=1)
    # farther out there is no footprint to hand over to
    far = read(firmspoints.picture_tile(buffer.getvalue(), z - 1, x // 2, y // 2, sensor_id="viirs"))
    assert set(far) == {"marks"} and far["marks"]["features"][0]["properties"]["foot"] == 0


def test_a_live_day_is_asked_again_after_its_minutes_and_an_older_one_is_not(client, monkeypatch):
    from azimut.api import satellite

    client.put("/api/settings/keys", json={"firms": "KEY123"})
    asked = _upstream(monkeypatch, _area_answer([]))
    params = {"window": "7d", "sensor": "modis"}
    assert client.get(_points_path(9), params=params).status_code == 200
    assert len(asked) == 2  # eight days, five and three
    clock = satellite.time.monotonic() + firms.LIVE_CACHE_SECONDS + 1
    monkeypatch.setattr(satellite.time, "monotonic", lambda: clock)
    assert client.get(_points_path(9), params=params).status_code == 200
    # only yesterday and today went stale, and they are one request
    today = datetime.now(timezone.utc).date()
    assert len(asked) == 3
    assert str(asked[-1].url).endswith(f"/2/{today - timedelta(days=1)}")


def test_the_points_held_stay_under_their_cap(monkeypatch):
    from azimut.api import satellite

    monkeypatch.setattr(satellite, "FIRMS_POINTS_CAP", 3)
    two = _points((1.0, 1.0, NOW, 0.4, 0.4), (1.0, 1.1, NOW, 0.4, 0.4))
    satellite._firms_store("VIIRS_SNPP_NRT", (0, 0), {date(2026, 9, 26): two})
    satellite._firms_store("VIIRS_SNPP_NRT", (0, 0), {date(2026, 9, 27): two})
    # the least recently drawn day went to make room
    assert list(satellite._firms_points) == [("VIIRS_SNPP_NRT", (0, 0), date(2026, 9, 27))]
    assert satellite._firms_rows == 2


def test_the_tiles_of_one_screen_fetch_a_cell_once(monkeypatch):
    from azimut.api import satellite

    release = threading.Event()
    answer = _area_answer([])

    def slow(request: httpx.Request) -> httpx.Response:
        release.wait(5)
        return answer(request)

    asked = _upstream(monkeypatch, slow)
    bounds = firms.tile_bounds(9, *_tile(*LYMAN, 9))
    done = []
    workers = [threading.Thread(target=lambda: done.append(
        satellite._firms_points_for("KEY", "viirs", "24h", bounds))) for _ in range(4)]
    for worker in workers:
        worker.start()
    threading.Event().wait(0.2)
    release.set()
    for worker in workers:
        worker.join(5)
    assert len(done) == 4
    assert len(asked) == 3


def test_a_refusal_from_the_area_api_is_read_through_the_status_endpoint(client, monkeypatch):
    client.put("/api/settings/keys", json={"firms": "KEY123"})

    def handler(request: httpx.Request) -> httpx.Response:
        if str(request.url).startswith(firms.STATUS_URL):
            return httpx.Response(200, json={"transaction_limit": 5000, "current_transactions": 4990})
        return httpx.Response(403, text="Exceeding allowed transaction limit")

    asked = _upstream(monkeypatch, handler)
    tile = _points_path(9)
    answer = client.get(tile)
    assert answer.status_code == 429
    assert client.get("/api/firms/sensors").json()["state"] == "ready"
    # paused: the next tile asks nobody
    before = len(asked)
    assert client.get(tile).status_code == 429
    assert len(asked) == before


def test_a_key_the_area_api_does_not_know_benches_the_layer(client, monkeypatch):
    client.put("/api/settings/keys", json={"firms": "KEY123"})

    def handler(request: httpx.Request) -> httpx.Response:
        if str(request.url).startswith(firms.STATUS_URL):
            return httpx.Response(403, text=UNKNOWN_KEY)
        return httpx.Response(400, text="Invalid MAP_KEY.")

    _upstream(monkeypatch, handler)
    answer = client.get(_points_path(9))
    assert answer.status_code == 502
    assert client.get("/api/firms/sensors").json()["state"] == "refused"


def test_the_extension_close_in_gets_the_same_drawing(client, monkeypatch):
    client.put("/api/settings/keys", json={"firms": "KEY123"})
    token = client.post("/api/settings/ingest-token").json()["ingest_token"]
    now = datetime.now(timezone.utc)
    asked = _upstream(monkeypatch, _area_answer([(*LYMAN, now - timedelta(hours=1))]))
    box = {"south": 48.9, "west": 37.7, "north": 49.1, "east": 37.9, "width": 800, "height": 600}
    answer = client.get("/api/ingest/firms", params=box, headers={"X-Azimut-Token": token})
    assert answer.status_code == 200
    assert asked and all(_is_area(request) for request in asked)
    image = _pixels(answer.content)
    assert image.shape == (600, 800, 4)
    assert image[..., 3].max() == 255
