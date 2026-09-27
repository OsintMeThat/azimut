"""NASA FIRMS active fire layer: the WMS request, its guards, and the route.

The point of these is that the shape of a request to a public service is read
here rather than off a fire: every URL below is built without asking NASA
anything, and the route tests stub the one call that would.
"""

from __future__ import annotations

import hashlib
import io
from datetime import date
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from PIL import Image

from azimut import config
from azimut.engine import firms
from mvtread import read


# -- the layer a question names ------------------------------------------------


def test_a_rolling_window_names_the_layer_that_already_holds_it():
    assert firms.layer_name("viirs", "24h") == "fires_viirs_24"
    assert firms.layer_name("viirs_noaa20", "7d") == "fires_viirs_noaa20_7"


def test_a_date_range_names_the_dated_layer_instead():
    # FIRMS files the same detections under two names: one rolling, one dated
    assert firms.layer_name("viirs", firms_dated := "dates") == "fires_viirs"
    assert firms.layer_name("modis", firms_dated) == "fires_modis"


def test_an_unknown_sensor_says_so_rather_than_building_a_url():
    with pytest.raises(KeyError):
        firms.layer_name("landsat", "24h")


# -- the tile's square ---------------------------------------------------------


def test_the_whole_world_is_one_tile_at_zoom_zero():
    left, bottom, right, top = firms.tile_bounds(0, 0, 0)
    assert (round(left), round(bottom)) == (-20037508, -20037508)
    assert (round(right), round(top)) == (20037508, 20037508)


def test_row_zero_is_the_north_because_the_two_grids_count_the_other_way():
    _, _, _, top = firms.tile_bounds(1, 0, 0)
    _, bottom, _, _ = firms.tile_bounds(1, 0, 1)
    assert round(top) == 20037508  # north in the projection, row 0 in the grid
    assert round(bottom) == -20037508


def test_the_four_tiles_of_a_level_tile_the_level_above():
    whole = firms.tile_bounds(0, 0, 0)
    parts = [firms.tile_bounds(1, x, y) for x in (0, 1) for y in (0, 1)]
    assert min(p[0] for p in parts) == pytest.approx(whole[0])
    assert max(p[2] for p in parts) == pytest.approx(whole[2])
    assert min(p[1] for p in parts) == pytest.approx(whole[1])
    assert max(p[3] for p in parts) == pytest.approx(whole[3])


# -- the request ---------------------------------------------------------------


def _query(url: str) -> dict[str, list[str]]:
    return parse_qs(urlparse(url).query)


def test_the_key_goes_in_the_path_where_firms_wants_it():
    url = firms.tile_url("KEY123", z=3, x=4, y=2)
    assert url.startswith(f"{firms.WMS_BASE}/KEY123/")
    # …and nowhere else: a key repeated in the query is a key logged twice
    assert "KEY123" not in urlparse(url).query


def _style(url: str) -> list[list[str]]:
    """The drawing FIRMS reads from the path: layers, symbols, sizes, colours."""
    path = urlparse(url).path
    return [part.split(",") for part in path.split("/KEY/", 1)[1].strip("/").split("/")]


def test_the_drawing_rides_in_the_path_one_entry_per_layer():
    layers, symbols, sizes, colours = _style(firms.tile_url("KEY", z=6, x=40, y=22))
    assert layers == ["fires_viirs_24"]
    assert symbols == ["square"]
    assert sizes == [str(firms.MARK_MIN_PX)]
    assert colours == ["+".join(str(c) for c in firms.RECENT_RGB)]
    # the layers FIRMS draws are the layers the query names
    assert _query(firms.tile_url("KEY", z=6, x=40, y=22))["LAYERS"] == ["fires_viirs_24"]


def test_a_window_longer_than_a_day_lays_the_last_24_hours_over_it():
    layers, symbols, sizes, colours = _style(firms.tile_url("KEY", window="7d", z=6, x=40, y=22))
    # lowest first: FIRMS draws the list in order, so the newest lands on top
    assert layers == ["fires_viirs_7", "fires_viirs_24"]
    assert colours == ["+".join(str(c) for c in firms.EARLIER_RGB), "+".join(str(c) for c in firms.RECENT_RGB)]
    assert len(symbols) == len(sizes) == 2


def test_a_dated_range_is_drawn_in_one_colour():
    url = firms.tile_url("KEY", window="dates", first="2026-08-01", last="2026-08-09", z=6, x=40, y=22)
    assert _style(url)[0] == ["fires_viirs"]


def test_far_out_a_detection_is_a_mark_seen_whatever_its_footprint():
    assert firms.mark_px("viirs", firms.tile_bounds(3, 4, 2), firms.TILE_SIZE) == firms.MARK_MIN_PX


def test_close_in_a_detection_is_its_footprint_on_the_ground():
    # z13 over Lyman: a 512 px tile is 4.9 km of Mercator, and the 375 m pixel
    # is stretched by 1/cos(49°) with the imagery under it
    x, y = 4956, 2814
    near = firms.mark_px("viirs", firms.tile_bounds(13, x, y), firms.TILE_SIZE)
    assert 55 <= near <= 62
    # MODIS sees a kilometre, and says so
    assert firms.mark_px("modis", firms.tile_bounds(13, x, y), firms.TILE_SIZE) > 2 * near


def test_the_same_footprint_is_drawn_bigger_where_mercator_stretches_the_ground():
    equator = firms.mark_px("viirs", firms.tile_bounds(13, 4096, 4095), firms.TILE_SIZE)
    north = firms.mark_px("viirs", firms.tile_bounds(13, 4096, 2600), firms.TILE_SIZE)
    assert north > equator


def test_a_tile_is_a_getmap_in_the_projection_the_grid_is_already_in():
    query = _query(firms.tile_url("K", z=5, x=8, y=11))
    assert query["REQUEST"] == ["GetMap"]
    assert query["CRS"] == ["EPSG:3857"]
    assert query["TRANSPARENT"] == ["TRUE"]
    assert query["WIDTH"] == [str(firms.TILE_SIZE)] and query["HEIGHT"] == [str(firms.TILE_SIZE)]
    # six decimals in the URL is a micrometre on the ground, and keeps the
    # address readable
    corners = [float(n) for n in query["BBOX"][0].split(",")]
    assert corners == pytest.approx(firms.tile_bounds(5, 8, 11))


def test_a_rolling_window_carries_no_dates():
    # they would be two more things to keep in step with a layer that already
    # means "the last 24 hours"
    assert "TIME" not in _query(firms.tile_url("K", window="24h", z=1, x=0, y=0))


def test_a_dated_window_carries_the_range_it_was_asked_for():
    query = _query(
        firms.tile_url("K", window="dates", first="2026-08-01", last="2026-08-09", z=1, x=0, y=0)
    )
    assert query["TIME"] == ["2026-08-01/2026-08-09"]
    assert query["LAYERS"] == ["fires_viirs"]


def test_one_day_is_a_range_of_itself():
    query = _query(firms.tile_url("K", window="dates", first="2026-08-01", z=1, x=0, y=0))
    assert query["TIME"] == ["2026-08-01/2026-08-01"]


# -- what the service will not answer ------------------------------------------


def test_a_backwards_range_is_read_the_way_it_was_meant():
    assert firms.window_range("2026-08-09", "2026-08-01") == firms.window_range(
        "2026-08-01", "2026-08-09"
    )


def test_a_range_longer_than_the_service_allows_is_refused_here():
    with pytest.raises(ValueError, match="at most 31 days"):
        firms.window_range("2026-01-01", "2026-03-01")


def test_the_longest_allowed_range_is_allowed():
    start, end = firms.window_range("2026-01-01", "2026-01-31")
    assert (end - start).days == firms.MAX_RANGE_DAYS - 1


@pytest.mark.parametrize("bad", ["", "2026-8-1", "01/08/2026", "yesterday", "2026-08-01T10:00"])
def test_only_one_date_form_reaches_a_public_service(bad):
    with pytest.raises(ValueError):
        firms.parse_day(bad)


# -- the picture ---------------------------------------------------------------


def _png(image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, "PNG")
    return buffer.getvalue()


def _pixels(content: bytes):
    with Image.open(io.BytesIO(content)) as image:
        return image.convert("RGBA").load()


def test_an_empty_picture_goes_back_as_it_came():
    empty = _png(Image.new("RGBA", (64, 64), (0, 0, 0, 0)))
    assert firms.dress(empty, firms.MARK_MIN_PX) == empty


def test_a_mark_gets_a_dark_ring_that_reads_on_any_ground():
    image = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    image.paste((*firms.RECENT_RGB, 255), (30, 30, 37, 37))
    dressed = _pixels(firms.dress(_png(image), firms.MARK_MIN_PX))
    # the mark keeps its colour…
    assert dressed[33, 33] == (*firms.RECENT_RGB, 255)
    # …the pixel beside it is the ring: dark and nearly opaque
    ring = dressed[31 - firms.RING_PX, 33]
    assert max(ring[:3]) < 40 and ring[3] > 200
    # …and a little further out the ground is left alone
    assert dressed[30 - firms.RING_PX - 2, 33][3] == 0


def test_a_footprint_seen_close_keeps_its_edge_and_shows_the_ground_inside():
    image = Image.new("RGBA", (96, 96), (0, 0, 0, 0))
    image.paste((*firms.RECENT_RGB, 255), (20, 20, 60, 60))
    dressed = _pixels(firms.dress(_png(image), 40))
    assert dressed[20, 40][3] == 255  # the edge
    inside = dressed[40, 40]
    assert inside[:3] == firms.RECENT_RGB
    assert abs(inside[3] - round(255 * firms.FOOTPRINT_FILL)) <= 1


def test_a_live_window_is_kept_minutes_and_a_past_range_hours():
    today = date(2026, 9, 26)
    assert firms.cache_seconds("24h", today=today) == firms.LIVE_CACHE_SECONDS
    assert firms.cache_seconds("7d", today=today) == firms.LIVE_CACHE_SECONDS
    # a range that reaches yesterday may still gain a late detection
    assert firms.cache_seconds("dates", "2026-09-20", "2026-09-25", today=today) == firms.LIVE_CACHE_SECONDS
    assert firms.cache_seconds("dates", "2026-09-01", "2026-09-24", today=today) == firms.PAST_CACHE_SECONDS


# -- what a refusal meant --------------------------------------------------------


def test_the_count_is_read_off_the_status_answer():
    body = '{ "transaction_limit" : 5000, "current_transactions": 4911, "transaction_interval" : "10 minutes" }'
    assert firms.allowance(body) == (4911, 5000)


@pytest.mark.parametrize("body", ["", "MAP_KEY is invalid", '{"current_transactions": "12"}', "[1, 2]"])
def test_anything_else_is_not_a_count(body):
    assert firms.allowance(body) is None


def test_a_refusal_is_read_back_as_the_sentence_it_contains():
    body = (
        '<?xml version="1.0"?><ServiceExceptionReport>'
        '<ServiceException code="InvalidKey">Invalid MAP_KEY</ServiceException>'
        "</ServiceExceptionReport>"
    )
    assert firms.service_error(body) == "Invalid MAP_KEY"


# -- the route -----------------------------------------------------------------


@pytest.fixture(autouse=True)
def a_fresh_firms_memory(monkeypatch):
    """No test inherits the pause or the verdict the previous one left."""
    from azimut.api import satellite

    monkeypatch.setattr(satellite, "_firms_verdict", None)
    monkeypatch.setattr(satellite, "_firms_rows", 0)
    satellite._firms_pause.clear()
    satellite._firms_points.clear()
    satellite._firms_flights.clear()
    yield
    satellite._firms_pause.clear()
    satellite._firms_points.clear()


def _answer_png() -> bytes:
    image = Image.new("RGBA", (firms.TILE_SIZE, firms.TILE_SIZE), (0, 0, 0, 0))
    image.paste((*firms.RECENT_RGB, 255), (100, 100, 107, 107))
    return _png(image)


def _upstream(monkeypatch, handler):
    """FIRMS behind a fake transport: every route asks through the pooled client."""
    from azimut.api import satellite

    asked: list[httpx.Request] = []

    def record(request: httpx.Request) -> httpx.Response:
        asked.append(request)
        return handler(request)

    monkeypatch.setattr(satellite, "_tile_client", httpx.Client(transport=httpx.MockTransport(record)))
    return asked


def _is_status(request: httpx.Request) -> bool:
    return str(request.url).startswith(firms.STATUS_URL)


def _never(request: httpx.Request) -> httpx.Response:
    raise AssertionError(f"asked FIRMS for {request.url}")


def test_the_layer_says_it_needs_a_key_before_anything_is_drawn(client):
    answer = client.get("/api/firms/sensors").json()
    assert answer["keyed"] is False
    assert answer["state"] == "missing"
    # …and the catalogue is there either way, so the panel can be built
    assert {s["id"] for s in answer["sensors"]} >= {"viirs", "modis"}
    assert answer["max_zoom"] == firms.MAX_ZOOM


def test_a_tile_without_a_key_is_a_404_rather_than_a_request(client):
    assert client.get("/api/firms/points/3/4/2").status_code == 404


def test_a_saved_key_lights_the_layer_up(client, monkeypatch):
    client.put("/api/settings/keys", json={"firms": "KEY123"})
    # read on mount and after every failed tile, so it must never phone NASA
    _upstream(monkeypatch, _never)
    answer = client.get("/api/firms/sensors").json()
    assert answer["keyed"] is True
    assert answer["state"] == "ready"
    assert answer["paused"] is None


def test_a_key_switched_off_withholds_the_layer_without_deleting_it(client):
    client.put("/api/settings/keys", json={"firms": "KEY123"})
    client.put("/api/settings/prefs", json={"providers_enabled": {"firms": False}})
    answer = client.get("/api/firms/sensors").json()
    assert answer["keyed"] is False
    # the row says "off", not "no key": the key is still there
    assert answer["state"] == "off"
    assert client.get("/api/firms/points/3/4/2").status_code == 404
    assert config.load_settings()["api_keys"]["firms"] == "KEY123"


def test_a_tile_deeper_than_the_layer_draws_is_refused_with_a_reason(client):
    client.put("/api/settings/keys", json={"firms": "KEY123"})
    answer = client.get(f"/api/firms/points/{firms.MAX_ZOOM + 1}/0/0")
    assert answer.status_code == 422
    assert str(firms.MAX_ZOOM) in answer.json()["detail"]


@pytest.mark.parametrize("path", ["/api/firms/points/-1/0/0", "/api/firms/points/3/8/0"])
def test_invalid_tile_coordinates_are_refused_before_key_lookup(client, monkeypatch, path):
    _upstream(monkeypatch, _never)
    assert client.get(path).status_code == 422


def test_a_date_the_service_would_refuse_never_reaches_it(client, monkeypatch):
    client.put("/api/settings/keys", json={"firms": "KEY123"})
    _upstream(monkeypatch, _never)
    answer = client.get(
        "/api/firms/points/3/4/2",
        params={"window": "dates", "first": "2026-01-01", "last": "2026-06-01"},
    )
    assert answer.status_code == 422


def test_a_far_tile_is_read_off_firms_picture_into_marks_with_the_key_left_behind(client, monkeypatch):
    client.put("/api/settings/keys", json={"firms": "KEY123"})
    asked = _upstream(
        monkeypatch, lambda request: httpx.Response(200, content=_answer_png(), headers={"content-type": "image/png"})
    )
    answer = client.get("/api/firms/points/3/4/2", params={"sensor": "modis", "window": "48h"})
    assert answer.status_code == 200
    assert answer.headers["content-type"] == "application/vnd.mapbox-vector-tile"
    # FIRMS's own picture of the tile, squares of one pixel so each is a place
    assert "fires_modis_48" in str(asked[0].url)
    assert "/square,square/1,1/" in str(asked[0].url)
    # the red square painted at 100-107 px comes back as red marks there
    marks = [(x, y, feature["properties"]) for feature in read(answer.content)["marks"]["features"]
             for [(x, y)] in feature["parts"]]
    assert marks and all(100 * 8 <= x < 107 * 8 and 100 * 8 <= y < 107 * 8 for x, y, _ in marks)
    assert {properties["recent"] for _, _, properties in marks} == {1}
    # no footprint comes with a picture's marks, so they never give way to one
    assert {properties["foot"] for _, _, properties in marks} == {0}
    assert answer.headers["cache-control"] == f"private, max-age={firms.LIVE_CACHE_SECONDS}"
    # the browser asked our own address; the credential stayed on this side
    assert "KEY123" not in str(answer.request.url)
    assert b"KEY123" not in answer.content


def test_a_past_range_may_be_kept_by_the_browser_for_hours(client, monkeypatch):
    client.put("/api/settings/keys", json={"firms": "KEY123"})
    _upstream(monkeypatch, lambda request: httpx.Response(200, content=_answer_png(), headers={"content-type": "image/png"}))
    answer = client.get(
        "/api/firms/points/3/4/2", params={"window": "dates", "first": "2026-01-01", "last": "2026-01-09"}
    )
    assert answer.headers["cache-control"] == f"private, max-age={firms.PAST_CACHE_SECONDS}"


#: Stands in for the 28 KB picture FIRMS really draws. What matters is the
#: digest, so the tests point the module at this one rather than shipping a
#: refusal placard into the repo.
PLACARD = b"placard"

SPENT = '{ "transaction_limit" : 5000, "current_transactions": 4911, "transaction_interval" : "10 minutes" }'
UNKNOWN_KEY = "MAP_KEY is invalid or your have exceeded your transaction/time limit. Please try again later."


def test_the_refusal_picture_is_recognised_for_what_it_is(monkeypatch):
    monkeypatch.setattr(firms, "PLACARD_SHA256", hashlib.sha256(PLACARD).hexdigest())
    assert firms.is_placard(PLACARD)
    assert not firms.is_placard(b"\x89PNG\r\n\x1a\n a real tile")


def _placard_then(monkeypatch, status: httpx.Response | Exception):
    """A tile answered with the placard, and the status endpoint with ``status``."""
    monkeypatch.setattr(firms, "PLACARD_SHA256", hashlib.sha256(PLACARD).hexdigest())

    def handler(request: httpx.Request) -> httpx.Response:
        if _is_status(request):
            if isinstance(status, Exception):
                raise status
            return status
        return httpx.Response(200, content=PLACARD, headers={"content-type": "image/png"})

    return _upstream(monkeypatch, handler)


def test_a_spent_allowance_pauses_the_layer_and_leaves_the_key_alone(client, monkeypatch):
    client.put("/api/settings/keys", json={"firms": "KEY123"})
    asked = _placard_then(monkeypatch, httpx.Response(200, text=SPENT))

    answer = client.get("/api/firms/points/3/4/2")
    assert answer.status_code == 429
    assert "allowance" in answer.json()["detail"]
    # the key is fine, and nothing says otherwise
    assert "firms" not in config.load_settings().get("provider_status", {})
    state = client.get("/api/firms/sensors").json()
    assert state["keyed"] is True and state["state"] == "ready"
    assert state["paused"]["used"] == 4911 and state["paused"]["of"] == 5000

    # while paused, a tile is refused here: asking would only add to the count,
    # and saying so asks nothing either
    before = len(asked)
    assert client.get("/api/firms/points/3/4/3").status_code == 429
    assert client.get("/api/firms/sensors").json()["paused"]
    assert len(asked) == before


def test_only_a_count_near_the_limit_explains_a_refusal():
    assert firms.spent(4911, 5000)  # a 31-day picture costs 93
    assert firms.spent(5000, 5000)
    assert not firms.spent(12, 5000)


def test_a_count_far_from_the_limit_pauses_nothing(client, monkeypatch):
    # the ten minutes turned over between the picture and the question, or the
    # refusal was something else: saying "allowance used up" would be untrue
    client.put("/api/settings/keys", json={"firms": "KEY123"})
    _placard_then(monkeypatch, httpx.Response(200, text=SPENT.replace("4911", "12")))
    answer = client.get("/api/firms/points/3/4/2")
    assert answer.status_code == 502
    assert "allowance" not in answer.json()["detail"]
    state = client.get("/api/firms/sensors").json()
    assert state["paused"] is None and state["state"] == "ready"


def test_the_pause_ends_on_its_own(client, monkeypatch):
    from azimut.api import satellite

    client.put("/api/settings/keys", json={"firms": "KEY123"})
    _placard_then(monkeypatch, httpx.Response(200, text=SPENT))
    client.get("/api/firms/points/3/4/2")
    satellite._firms_pause["until"] = 0  # a minute later
    assert client.get("/api/firms/sensors").json()["paused"] is None


def test_a_key_the_service_does_not_know_benches_the_layer(client, monkeypatch):
    client.put("/api/settings/keys", json={"firms": "KEY123"})
    _placard_then(monkeypatch, httpx.Response(403, text=UNKNOWN_KEY))

    answer = client.get("/api/firms/points/3/4/2")
    assert answer.status_code == 502
    assert answer.json()["detail"] == "FIRMS does not know this key"
    # the Layers row says the key was refused instead of asking for a thousand
    # more placards, and Settings keeps FIRMS's own sentence
    state = client.get("/api/firms/sensors").json()
    assert state["keyed"] is False
    assert state["state"] == "refused"
    verdict = config.load_settings()["provider_status"]["firms"]
    assert verdict["ok"] is False and verdict["detail"].startswith("MAP_KEY is invalid")


def test_a_status_question_that_fails_says_nothing_about_the_key(client, monkeypatch):
    client.put("/api/settings/keys", json={"firms": "KEY123"})
    _placard_then(monkeypatch, httpx.ConnectError("offline"))

    answer = client.get("/api/firms/points/3/4/2")
    assert answer.status_code == 502
    assert client.get("/api/firms/sensors").json()["state"] == "ready"
    assert client.get("/api/firms/sensors").json()["paused"] is None


def test_a_burst_of_placards_asks_the_status_question_once(client, monkeypatch):
    client.put("/api/settings/keys", json={"firms": "KEY123"})
    asked = _placard_then(monkeypatch, httpx.Response(200, text="not a count"))
    for y in range(3):
        assert client.get(f"/api/firms/points/3/4/{y}").status_code == 502
    assert sum(_is_status(request) for request in asked) == 1


def test_a_new_key_clears_the_refusal(client, monkeypatch):
    client.put("/api/settings/keys", json={"firms": "KEY123"})
    _placard_then(monkeypatch, httpx.Response(403, text=UNKNOWN_KEY))
    client.get("/api/firms/points/3/4/2")
    client.put("/api/settings/keys", json={"firms": "KEY456"})
    assert client.get("/api/firms/sensors").json()["state"] == "ready"


def test_the_extension_route_is_paused_and_dressed_the_same_way(client, monkeypatch):
    client.put("/api/settings/keys", json={"firms": "KEY123"})
    token = client.post("/api/settings/ingest-token").json()["ingest_token"]
    headers = {"X-Azimut-Token": token}
    # far enough out that the WMS draws it; close in, the points do (test_firms_points.py)
    box = {"south": 44, "west": 30, "north": 54, "east": 45, "width": 512, "height": 512}
    asked = _upstream(
        monkeypatch, lambda request: httpx.Response(200, content=_answer_png(), headers={"content-type": "image/png"})
    )
    answer = client.get("/api/ingest/firms", params=box, headers=headers)
    assert answer.status_code == 200
    assert _pixels(answer.content)[100 - firms.RING_PX, 103][3] > 200
    assert "/square/" in str(asked[0].url)

    from azimut.api import satellite

    satellite._firms_pause.update(until=float("inf"), until_utc="2026-09-26T12:00:00+00:00", used=4990, of=5000)
    assert client.get("/api/ingest/firms", params=box, headers=headers).status_code == 429
    assert len(asked) == 1


def test_the_key_test_asks_the_service_about_the_key_rather_than_using_it(client, monkeypatch):
    client.put("/api/settings/keys", json={"firms": "x"})
    asked = {}

    def fake_get(url, **kwargs):
        asked["url"] = url
        asked["params"] = kwargs.get("params")
        return httpx.Response(
            403,
            content=b"MAP_KEY is invalid or your have exceeded your transaction/time limit.",
            headers={"content-type": "text/html"},
            request=httpx.Request("GET", url),
        )

    monkeypatch.setattr(httpx, "get", fake_get)
    answer = client.post("/api/settings/keys/firms/test").json()
    assert answer["ok"] is False
    assert "invalid" in answer["detail"]
    # the endpoint that answers the question, not a GetMap that answers a
    # picture either way
    assert asked["url"] == firms.STATUS_URL
    assert asked["params"] == {"MAP_KEY": "x"}


def test_a_key_the_service_accepts_passes(client, monkeypatch):
    client.put("/api/settings/keys", json={"firms": "KEY123"})
    monkeypatch.setattr(
        httpx,
        "get",
        lambda url, **kw: httpx.Response(
            200, content=b"current_transactions: 12", request=httpx.Request("GET", url)
        ),
    )
    assert client.post("/api/settings/keys/firms/test").json()["ok"] is True


def test_a_refusal_is_repeated_in_the_service_s_own_words():
    said = firms.status_error("<html><body>MAP_KEY is invalid or your have exceeded</body></html>")
    assert said.startswith("MAP_KEY is invalid")
    assert "<" not in said
    assert firms.status_error("") == "FIRMS would not accept this key"


def test_a_service_exception_is_reported_with_what_it_said(client, monkeypatch):
    client.put("/api/settings/keys", json={"firms": "BAD"})
    _upstream(
        monkeypatch,
        lambda request: httpx.Response(
            200,
            content=b"<ServiceExceptionReport><ServiceException>Invalid MAP_KEY"
            b"</ServiceException></ServiceExceptionReport>",
            headers={"content-type": "text/xml"},
        ),
    )
    answer = client.get("/api/firms/points/3/4/2")
    assert answer.status_code == 502
    assert "Invalid MAP_KEY" in answer.json()["detail"]
