"""Forward geocoding (/api/geo/geocode): Nominatim behind a mock, never the network."""

import pytest

from azimut.engine import geo

# The suite's autouse fixture replaces geo.reverse_geocode with an offline stub,
# so the two tests below — the ones that care about what goes out on the wire —
# hold on to the real function, captured at import time.
_REAL_REVERSE = geo.reverse_geocode


class _FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


def _fake_get(payload):
    calls = {}

    def fake(url, params=None, headers=None, timeout=None):
        calls["url"] = url
        calls["params"] = params
        calls["headers"] = headers
        return _FakeResponse(payload)

    return fake, calls


def test_geocode_returns_top_match(client, monkeypatch):
    fake, calls = _fake_get(
        [{"lat": "48.8584", "lon": "2.2945", "display_name": "Tour Eiffel, Paris, France"}]
    )
    monkeypatch.setattr(geo.httpx, "get", fake)

    result = client.get("/api/geo/geocode", params={"q": "tour eiffel"}).json()
    assert result["lat"] == 48.8584
    assert result["lon"] == 2.2945
    assert result["display_name"] == "Tour Eiffel, Paris, France"
    assert "OpenStreetMap" in result["attribution"]
    # polite Nominatim usage: identified UA, single result requested
    assert calls["params"]["q"] == "tour eiffel"
    assert calls["params"]["limit"] == 1
    assert calls["headers"]["User-Agent"]


def test_geocode_answers_in_english(client, monkeypatch):
    # the query goes out in whatever language it was typed; only the answer is
    # pinned, so "Москва" comes back as a name the analyst can read
    fake, calls = _fake_get([{"lat": "55.75", "lon": "37.61", "display_name": "Moscow, Russia"}])
    monkeypatch.setattr(geo.httpx, "get", fake)

    result = client.get("/api/geo/geocode", params={"q": "Москва"}).json()
    assert calls["params"]["q"] == "Москва"
    assert calls["params"]["accept-language"] == "en"
    assert result["display_name"] == "Moscow, Russia"


def test_reverse_stays_in_the_local_language(monkeypatch):
    # the Post and Proof composers read this endpoint and name a place the way
    # it is named where it is — asking for English here would change their copy
    fake, calls = _fake_get({"display_name": "Москва, Россия", "address": {"country": "Россия"}})
    monkeypatch.setattr(geo.httpx, "get", fake)

    result = _REAL_REVERSE(55.75, 37.61)
    assert "accept-language" not in calls["params"]
    assert result["display_name"] == "Москва, Россия"


def test_reverse_asks_for_a_language_only_when_told_to(monkeypatch):
    fake, calls = _fake_get({"display_name": "Moscow, Russia", "address": {}})
    monkeypatch.setattr(geo.httpx, "get", fake)

    _REAL_REVERSE(55.75, 37.61, language="en")
    assert calls["params"]["accept-language"] == "en"


def test_geocode_no_match_is_404(client, monkeypatch):
    fake, _ = _fake_get([])
    monkeypatch.setattr(geo.httpx, "get", fake)
    response = client.get("/api/geo/geocode", params={"q": "zzzz nowhere zzzz"})
    assert response.status_code == 404


def test_geocode_empty_query_is_422(client):
    response = client.get("/api/geo/geocode", params={"q": "   "})
    assert response.status_code == 422


def test_geocode_network_failure_is_404(client, monkeypatch):
    def boom(*args, **kwargs):
        raise OSError("network down")

    monkeypatch.setattr(geo.httpx, "get", boom)
    # engine swallows the error (best-effort) → API reports no match
    response = client.get("/api/geo/geocode", params={"q": "paris"})
    assert response.status_code == 404


# -- /api/geo/parse: pure offline conversion, no network -------------------------------


def test_parse_returns_every_format_and_the_map_links(client):
    result = client.post("/api/geo/parse", json={"text": "48.8583701, 2.2944813"}).json()
    assert result["lat"] == pytest.approx(48.8583701)
    assert result["lon"] == pytest.approx(2.2944813)
    # flat keys the Post Composer reads by name stay in place
    assert result["dms"].endswith('E')
    assert "+" in result["plus_code"]
    # the ordered list the Coordinates tool renders
    assert [f["id"] for f in result["formats"]] == [
        "dd", "ddm", "dms", "utm", "mgrs", "plus_code", "geohash",
    ]
    # all nine external maps, keyed by site
    assert set(result["links"]) >= {"google", "yandex", "bing", "sentinel"}


def test_parse_accepts_the_formats_it_emits(client):
    for text in ("31U 448251 5411952", "u09tunqu9", "48°51.502'N 2°17.669'E"):
        response = client.post("/api/geo/parse", json={"text": text})
        assert response.status_code == 200, text
        body = response.json()
        assert body["lat"] == pytest.approx(48.858, abs=1e-2)
        assert body["lon"] == pytest.approx(2.294, abs=1e-2)


def test_parse_rejects_gibberish_with_422(client):
    assert client.post("/api/geo/parse", json={"text": "hello world"}).status_code == 422


# -- /api/geo/sky ---------------------------------------------------------------
#
# The geometry itself is covered in tests/test_sky.py. What matters here is the
# contract the panel reads: local and UTC side by side, states instead of errors,
# a curve that spans the day, and validation at the edge.


def test_sky_reports_every_instant_in_local_time_and_utc(client):
    response = client.get(
        "/api/geo/sky",
        params={"lat": 48.8584, "lon": 2.2945, "date": "2026-07-30", "time": "14:20"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["zone"]["name"] == "Europe/Paris"
    assert body["zone"]["abbreviation"] == "CEST"
    assert body["moment"]["local"].startswith("2026-07-30T14:20")
    assert body["moment"]["utc"] == "2026-07-30T12:20:00Z"
    for stamp in (body["sun"]["rise"], body["sun"]["set"], body["sun"]["transit"]):
        assert stamp["utc"].endswith("Z")
        assert stamp["offset"] == "+02:00"
        assert stamp["abbreviation"] == "CEST"


def test_sky_gives_the_positions_at_the_moment_asked_for(client):
    response = client.get(
        "/api/geo/sky",
        params={"lat": 48.8584, "lon": 2.2945, "date": "2026-07-30", "time": "14:20"},
    )
    body = response.json()
    assert 180 < body["sun"]["azimuth"] < 220  # early afternoon, past due south
    assert body["sun"]["altitude"] > 50
    assert 0 <= body["moon"]["illuminated"] <= 1
    assert body["moon"]["phase"]
    assert isinstance(body["moon"]["waxing"], bool)
    assert body["moon"]["distance_km"] > 300_000


def test_sky_defaults_to_local_midday_today(client):
    """No date and no time: the point's own today, read at local noon."""
    body = client.get("/api/geo/sky", params={"lat": 48.8584, "lon": 2.2945}).json()
    assert body["moment"]["local"][11:16] == "12:00"
    assert body["date"] == body["moment"]["local"][:10]


def test_sky_reports_the_midnight_sun_as_a_state(client):
    body = client.get(
        "/api/geo/sky", params={"lat": 69.6492, "lon": 18.9553, "date": "2026-06-21"}
    ).json()
    assert body["sun"]["state"] == "always_up"
    assert body["sun"]["rise"] is None
    assert body["sun"]["set"] is None
    assert body["sun"]["transit_altitude"] > 40


def test_sky_reports_polar_night_as_a_state(client):
    body = client.get(
        "/api/geo/sky", params={"lat": -89.0, "lon": 0.0, "date": "2026-06-21"}
    ).json()
    assert body["sun"]["state"] == "always_down"
    assert body["twilight"]["astronomical"]["state"] == "always_down"


def test_sky_carries_the_moon_events_as_lists(client):
    body = client.get(
        "/api/geo/sky", params={"lat": 48.8584, "lon": 2.2945, "date": "2026-07-30"}
    ).json()
    assert isinstance(body["moon"]["rises"], list)
    assert len(body["moon"]["rise_azimuths"]) == len(body["moon"]["rises"])
    assert len(body["moon"]["set_azimuths"]) == len(body["moon"]["sets"])


def test_sky_curve_spans_the_day_in_minutes_from_local_midnight(client):
    body = client.get(
        "/api/geo/sky", params={"lat": 48.8584, "lon": 2.2945, "date": "2026-07-30"}
    ).json()
    curve = body["curve"]
    assert curve["minutes"][0] == 0
    assert curve["minutes"][-1] == 1440
    for key in ("sun_altitude", "sun_azimuth", "moon_altitude", "moon_azimuth"):
        assert len(curve[key]) == len(curve["minutes"])


def test_sky_curve_follows_a_daylight_saving_day(client):
    """The x axis is minutes of the local day, so it is 23 hours long in March."""
    body = client.get(
        "/api/geo/sky", params={"lat": 48.8584, "lon": 2.2945, "date": "2026-03-29"}
    ).json()
    assert body["curve"]["minutes"][-1] == 1380
    assert body["zone"]["abbreviation"] == "CEST"


def test_sky_curve_carries_the_wall_clock_of_each_sample(client):
    """Anything that labels a sample to the reader reads this, because the wall
    clock cannot be divided out of the minute count."""
    body = client.get(
        "/api/geo/sky", params={"lat": 48.8584, "lon": 2.2945, "date": "2026-07-30"}
    ).json()
    curve = body["curve"]
    assert len(curve["clock"]) == len(curve["minutes"])
    assert curve["clock"][0] == "00:00"
    assert curve["clock"][6] == "01:00"
    assert curve["clock"][-1] == "00:00"  # the following midnight


def test_sky_clock_skips_the_hour_daylight_saving_took(client):
    """On the spring-forward day the local clock jumps from 02:00 to 03:00, so no
    sample reads 02:xx while the minute count runs straight through."""
    body = client.get(
        "/api/geo/sky", params={"lat": 48.8584, "lon": 2.2945, "date": "2026-03-29"}
    ).json()
    curve = body["curve"]
    assert not [stamp for stamp in curve["clock"] if stamp.startswith("02:")]
    assert "03:00" in curve["clock"]
    # the sample two hours of elapsed time in reads 03:00, not 02:00
    assert curve["clock"][curve["minutes"].index(120)] == "03:00"


def test_sky_clock_repeats_the_hour_daylight_saving_gave_back(client):
    """And on the autumn day 02:00 to 03:00 happens twice."""
    body = client.get(
        "/api/geo/sky", params={"lat": 48.8584, "lon": 2.2945, "date": "2026-10-25"}
    ).json()
    assert body["curve"]["clock"].count("02:00") == 2


def test_sky_accepts_a_zone_override(client):
    body = client.get(
        "/api/geo/sky",
        params={
            "lat": 48.8584,
            "lon": 2.2945,
            "date": "2026-07-30",
            "time": "12:00",
            "zone": "UTC",
        },
    ).json()
    assert body["zone"]["name"] == "UTC"
    assert body["moment"]["utc"] == "2026-07-30T12:00:00Z"


@pytest.mark.parametrize("zone", ["Mars/Olympus", "../../../etc/passwd", "A" * 5000])
def test_sky_refuses_a_zone_it_cannot_load(client, zone):
    """Rather than answering in UTC under the name that was asked for, which would
    put every time in the response an offset out with nothing saying so."""
    response = client.get(
        "/api/geo/sky",
        params={"lat": 48.8584, "lon": 2.2945, "date": "2026-07-30", "zone": zone},
    )
    assert response.status_code == 422


@pytest.mark.parametrize(
    "params",
    [
        {"lat": 91, "lon": 0},
        {"lat": 0, "lon": 181},
        {"lat": 0, "lon": 0, "date": "30-07-2026"},
        {"lat": 0, "lon": 0, "time": "25h"},
    ],
)
def test_sky_validates_at_the_edge(client, params):
    assert client.get("/api/geo/sky", params=params).status_code == 422


def test_sky_never_touches_the_network(client, monkeypatch):
    """Opening the panel must not phone out. The reverse geocode beside it in the
    same tool does; this route is pure computation, and stays that way."""
    import httpx

    def explode(*args, **kwargs):
        raise AssertionError("the sky is computed locally")

    monkeypatch.setattr(httpx.Client, "get", explode)
    monkeypatch.setattr(httpx.Client, "send", explode)
    response = client.get(
        "/api/geo/sky", params={"lat": 48.8584, "lon": 2.2945, "date": "2026-07-30"}
    )
    assert response.status_code == 200
