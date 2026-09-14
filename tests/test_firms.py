"""NASA FIRMS active fire layer: the WMS request, its guards, and the route.

The point of these is that the shape of a request to a public service is read
here rather than off a fire: every URL below is built without asking NASA
anything, and the route tests stub the one call that would.
"""

from __future__ import annotations

import hashlib
from urllib.parse import parse_qs, urlparse

import httpx
import pytest

from azimut import config
from azimut.engine import firms


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
    assert url.startswith(f"{firms.WMS_BASE}/KEY123/?")
    # …and nowhere else: a key repeated in the query is a key logged twice
    assert "KEY123" not in urlparse(url).query


def test_a_tile_is_a_getmap_in_the_projection_the_grid_is_already_in():
    query = _query(firms.tile_url("K", z=5, x=8, y=11))
    assert query["REQUEST"] == ["GetMap"]
    assert query["CRS"] == ["EPSG:3857"]
    assert query["TRANSPARENT"] == ["TRUE"]
    assert query["WIDTH"] == ["256"] and query["HEIGHT"] == ["256"]
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


def test_the_zoom_guard_stops_where_a_mark_stops_meaning_one_detection():
    assert not firms.too_deep(firms.MAX_ZOOM)
    assert firms.too_deep(firms.MAX_ZOOM + 1)


def test_a_refusal_is_read_back_as_the_sentence_it_contains():
    body = (
        '<?xml version="1.0"?><ServiceExceptionReport>'
        '<ServiceException code="InvalidKey">Invalid MAP_KEY</ServiceException>'
        "</ServiceExceptionReport>"
    )
    assert firms.service_error(body) == "Invalid MAP_KEY"


# -- the route -----------------------------------------------------------------


def test_the_layer_says_it_needs_a_key_before_anything_is_drawn(client):
    answer = client.get("/api/firms/sensors").json()
    assert answer["keyed"] is False
    # …and the catalogue is there either way, so the panel can be built
    assert {s["id"] for s in answer["sensors"]} >= {"viirs", "modis"}
    assert answer["max_zoom"] == firms.MAX_ZOOM


def test_a_tile_without_a_key_is_a_404_rather_than_a_request(client):
    assert client.get("/api/firms/tiles/3/4/2").status_code == 404


def test_a_saved_key_lights_the_layer_up(client):
    client.put("/api/settings/keys", json={"firms": "KEY123"})
    assert client.get("/api/firms/sensors").json()["keyed"] is True


def test_a_key_switched_off_withholds_the_layer_without_deleting_it(client):
    client.put("/api/settings/keys", json={"firms": "KEY123"})
    client.put("/api/settings/prefs", json={"providers_enabled": {"firms": False}})
    assert client.get("/api/firms/sensors").json()["keyed"] is False
    assert client.get("/api/firms/tiles/3/4/2").status_code == 404
    # the key is still there, which is the whole difference from deleting it
    assert config.load_settings()["api_keys"]["firms"] == "KEY123"


def test_a_tile_deeper_than_the_layer_draws_is_refused_with_a_reason(client):
    client.put("/api/settings/keys", json={"firms": "KEY123"})
    answer = client.get(f"/api/firms/tiles/{firms.MAX_ZOOM + 1}/0/0")
    assert answer.status_code == 422
    assert str(firms.MAX_ZOOM) in answer.json()["detail"]


@pytest.mark.parametrize("path", ["/api/firms/tiles/-1/0/0", "/api/firms/tiles/3/8/0"])
def test_invalid_tile_coordinates_are_refused_before_key_lookup(client, monkeypatch, path):
    def never(*args, **kwargs):
        raise AssertionError("asked FIRMS for invalid tile coordinates")

    monkeypatch.setattr(httpx, "get", never)
    assert client.get(path).status_code == 422


def test_a_date_the_service_would_refuse_never_reaches_it(client, monkeypatch):
    client.put("/api/settings/keys", json={"firms": "KEY123"})

    def never(*args, **kwargs):
        raise AssertionError("asked FIRMS for a range it refuses")

    monkeypatch.setattr(httpx, "get", never)
    answer = client.get(
        "/api/firms/tiles/3/4/2",
        params={"window": "dates", "first": "2026-01-01", "last": "2026-06-01"},
    )
    assert answer.status_code == 422


def test_a_tile_comes_back_as_a_png_with_the_key_left_behind(client, monkeypatch):
    client.put("/api/settings/keys", json={"firms": "KEY123"})
    asked = {}

    def fake_get(url, **kwargs):
        asked["url"] = url
        return httpx.Response(
            200,
            content=b"\x89PNG\r\n\x1a\n",
            headers={"content-type": "image/png"},
            request=httpx.Request("GET", url),
        )

    monkeypatch.setattr(httpx, "get", fake_get)
    answer = client.get("/api/firms/tiles/3/4/2", params={"sensor": "modis", "window": "48h"})
    assert answer.status_code == 200
    assert answer.headers["content-type"] == "image/png"
    assert "fires_modis_48" in asked["url"]
    # the browser asked our own address; the credential stayed on this side
    assert "KEY123" not in str(answer.request.url)


#: Stands in for the 28 KB picture FIRMS really draws. What matters is the
#: digest, so the tests point the module at this one rather than shipping a
#: refusal placard into the repo.
PLACARD = b"placard"


def test_the_refusal_picture_is_recognised_for_what_it_is(monkeypatch):
    monkeypatch.setattr(firms, "PLACARD_SHA256", hashlib.sha256(PLACARD).hexdigest())
    assert firms.is_placard(PLACARD)
    assert not firms.is_placard(b"\x89PNG\r\n\x1a\n a real tile")


def test_a_placard_is_refused_rather_than_tiled_over_the_ground(client, monkeypatch):
    # FIRMS answers a key it rejects with 200 and a picture saying so, so
    # nothing in the HTTP answer says anything is wrong
    client.put("/api/settings/keys", json={"firms": "KEY123"})
    monkeypatch.setattr(firms, "PLACARD_SHA256", hashlib.sha256(PLACARD).hexdigest())
    monkeypatch.setattr(
        httpx,
        "get",
        lambda url, **kw: httpx.Response(
            200,
            content=PLACARD,
            headers={"content-type": "image/png"},
            request=httpx.Request("GET", url),
        ),
    )
    answer = client.get("/api/firms/tiles/3/4/2")
    assert answer.status_code == 502
    assert "key" in answer.json()["detail"]


def test_that_refusal_benches_the_layer_the_way_a_dead_basemap_key_is_benched(client, monkeypatch):
    client.put("/api/settings/keys", json={"firms": "KEY123"})
    monkeypatch.setattr(firms, "PLACARD_SHA256", hashlib.sha256(PLACARD).hexdigest())
    monkeypatch.setattr(
        httpx,
        "get",
        lambda url, **kw: httpx.Response(
            200,
            content=PLACARD,
            headers={"content-type": "image/png"},
            request=httpx.Request("GET", url),
        ),
    )
    client.get("/api/firms/tiles/3/4/2")
    # the Layers row goes back to "add a key", with the reason, instead of
    # asking for a thousand more placards
    assert client.get("/api/firms/sensors").json()["keyed"] is False
    assert config.load_settings()["provider_status"]["firms"]["ok"] is False


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

    def fake_get(url, **kwargs):
        return httpx.Response(
            200,
            content=b"<ServiceExceptionReport><ServiceException>Invalid MAP_KEY"
            b"</ServiceException></ServiceExceptionReport>",
            headers={"content-type": "text/xml"},
            request=httpx.Request("GET", url),
        )

    monkeypatch.setattr(httpx, "get", fake_get)
    answer = client.get("/api/firms/tiles/3/4/2")
    assert answer.status_code == 502
    assert "Invalid MAP_KEY" in answer.json()["detail"]
