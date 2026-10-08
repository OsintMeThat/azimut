"""The panorama the Horizon tab looks through, served over synthetic relief."""

import base64
import math
import struct
import zlib

import numpy as np
import pytest

from azimut.engine import terrain
from fakerelief import Peak, Relief, offset

EYE = (45.0, 6.0)
PEAK = Peak(*offset(*EYE, 90.0, 15_000.0), height=2500.0, radius=1500.0)


@pytest.fixture(autouse=True)
def synthetic_relief(monkeypatch):
    terrain.forget_decoded()
    relief = Relief(peaks=(PEAK,))
    monkeypatch.setattr(terrain, "tile", relief)
    yield relief
    terrain.forget_decoded()


def _unpack(text, dtype, shape):
    return np.frombuffer(zlib.decompress(base64.b64decode(text)), dtype=dtype).reshape(shape)


def _depth(body, rows, columns):
    """Metres per pixel from the 16-bit log codes, NaN for sky."""
    codes = _unpack(body["depth"], "<u2", (rows, columns)).astype(np.float64)
    scale = body["depth_scale"]
    metres = scale["min"] * np.exp((codes - 1) / scale["codes"] * math.log(scale["max"] / scale["min"]))
    return np.where(codes == 0, np.nan, metres)


def _ask(client, **body):
    return client.post("/api/horizon/panorama", json={"lat": EYE[0], "lon": EYE[1], **body})


def test_a_panorama_carries_the_picture_and_how_to_read_it(client):
    answer = _ask(client, step=1.0, far=40_000)
    assert answer.status_code == 200, answer.text
    body = answer.json()
    columns, rows = body["azimuth"]["count"], body["elevation"]["count"]
    assert columns == 360 and body["azimuth"]["step"] == 1.0
    # the band reaches a few degrees over the highest ridge, and down to a walker's feet
    peak_angle = max(body["skyline"])
    assert body["elevation"]["top"] == math.ceil(peak_angle + 3)
    assert body["elevation"]["top"] - (rows - 1) == -25
    depth = _depth(body, rows, columns)
    east = _unpack(body["normal_east"], "i1", (rows, columns))
    assert np.isnan(depth[0]).all()  # the top row is sky all round
    looking_at_peak = depth[:, 90]
    assert np.nanmax(looking_at_peak) == pytest.approx(15_000, rel=0.08)
    # the face seen leans back toward the eye, which looks east: its normal points west
    face = int(np.argmax(~np.isnan(looking_at_peak))) + 3
    assert east[face, 90] < 0
    assert body["observer"]["altitude"] == pytest.approx(body["observer"]["ground"] + 1.7, abs=0.05)
    assert body["credits"][0]["label"] == "Mapterhorn"


def test_distance_codes_keep_one_part_in_five_thousand_at_every_range():
    from azimut.api import horizon as horizon_api

    metres = np.array([1.0, 37.0, 950.0, 15_000.0, 149_999.0, 499_000.0, np.nan])
    codes = horizon_api.depth_codes(metres)
    assert codes.dtype == np.uint16 and codes[-1] == 0 and (codes[:-1] > 0).all()
    span = math.log(horizon_api.DEPTH_MAX / horizon_api.DEPTH_MIN)
    back = horizon_api.DEPTH_MIN * np.exp((codes[:-1] - 1) / horizon_api.DEPTH_CODES * span)
    assert np.all(np.abs(back / metres[:-1] - 1) < 2e-4)


def test_a_window_of_the_turn_is_drawn_at_its_own_step(client):
    whole = _ask(client, step=1.0, far=40_000).json()
    window = _ask(client, step=0.05, far=40_000, azimuth_start=80, azimuth_span=20,
                  top=whole["elevation"]["top"], bottom=-5).json()
    assert window["azimuth"] == {"start": 80.0, "step": 0.05, "count": 400, "full": False}
    assert whole["azimuth"]["full"] is True
    rows, columns = window["elevation"]["count"], window["azimuth"]["count"]
    depth = _depth(window, rows, columns)
    # column 200 looks due east, at the peak, as column 90 of the whole turn does
    assert np.nanmax(depth[:, 200]) == pytest.approx(15_000, rel=0.08)


def test_a_window_across_north_wraps_round(client):
    body = _ask(client, step=0.5, far=30_000, azimuth_start=350, azimuth_span=20, top=10, bottom=-5).json()
    assert body["azimuth"]["count"] == 40
    assert len(body["skyline"]) == 40


def test_a_drone_picture_reaches_further_down(client):
    body = _ask(client, step=1.0, far=40_000, mode="drone", height=300).json()
    assert body["elevation"]["top"] - (body["elevation"]["count"] - 1) == -75
    assert body["observer"]["altitude"] == pytest.approx(body["observer"]["ground"] + 300, abs=0.05)


def test_an_asked_band_is_kept(client):
    body = _ask(client, step=0.5, far=30_000, top=12, bottom=-4).json()
    assert body["elevation"]["top"] == 12
    assert body["elevation"]["count"] == 33


@pytest.mark.parametrize("body", [
    {"mode": "ground", "height": 250},
    {"mode": "drone", "height": 0},
    {"mode": "aircraft", "height": 20000},
    {"top": 5, "bottom": 10},
    {"step": 0.001},
    {"lat": 88},
])
def test_the_panorama_refuses_an_eye_it_cannot_place(client, body):
    assert client.post("/api/horizon/panorama", json={"lat": EYE[0], "lon": EYE[1], **body}).status_code == 422


def test_an_aircraft_under_the_ground_is_told_so(client, monkeypatch):
    monkeypatch.setattr(terrain, "tile", Relief(peaks=(Peak(*EYE, height=3000.0, radius=2000.0),)))
    terrain.forget_decoded()
    answer = _ask(client, step=1.0, mode="aircraft", height=1500)
    assert answer.status_code == 422
    assert "under the ground" in answer.json()["detail"]


def test_a_picture_too_large_is_refused_before_it_is_drawn(client):
    answer = _ask(client, step=0.02, top=90, bottom=-90)
    assert answer.status_code == 422
    assert "too large" in answer.json()["detail"]


def test_terrain_out_of_reach_is_a_bad_gateway(client, monkeypatch):
    def down(z, x, y):
        raise terrain.TerrainUnavailable("offline")

    monkeypatch.setattr(terrain, "tile", down)
    terrain.forget_decoded()
    answer = _ask(client, step=1.0)
    assert answer.status_code == 502


def test_a_point_on_the_map_is_placed_in_the_view(client):
    # on the face turned toward the eye
    face = offset(*EYE, 90.0, 13_500.0)
    answer = client.post("/api/horizon/target", json={
        "lat": EYE[0], "lon": EYE[1], "target_lat": face[0], "target_lon": face[1],
    })
    assert answer.status_code == 200, answer.text
    body = answer.json()
    assert body["azimuth"] == pytest.approx(90.0, abs=0.1)
    assert body["distance"] == pytest.approx(13_500, rel=0.001)
    assert body["visible"] is True
    assert body["ground"] == pytest.approx(PEAK.height * math.exp(-(1500 ** 2) / (2 * 1500 ** 2)), abs=20)
    assert body["angle"] > 0


def test_the_top_of_a_round_summit_seen_from_below_hides_behind_its_shoulder(client):
    # the ground just before the top stands higher in the eye than the top
    # itself: the model says so rather than pretending to see it
    body = client.post("/api/horizon/target", json={
        "lat": EYE[0], "lon": EYE[1], "target_lat": PEAK.lat, "target_lon": PEAK.lon,
    }).json()
    assert body["visible"] is False
    assert -0.1 < body["margin_deg"] < 0


def test_a_point_behind_the_peak_is_hidden_and_says_by_how_much(client):
    behind = offset(*EYE, 90.0, 25_000.0)
    body = client.post("/api/horizon/target", json={
        "lat": EYE[0], "lon": EYE[1], "target_lat": behind[0], "target_lon": behind[1],
    }).json()
    assert body["visible"] is False
    assert body["margin_deg"] < 0
    # a mast tall enough clears the summit
    tall = client.post("/api/horizon/target", json={
        "lat": EYE[0], "lon": EYE[1], "target_lat": behind[0], "target_lon": behind[1],
        "target_height": 6000,
    }).json()
    assert tall["visible"] is True


def test_a_point_out_of_reach_is_refused(client):
    answer = client.post("/api/horizon/target", json={
        "lat": EYE[0], "lon": EYE[1], "target_lat": EYE[0] + 10, "target_lon": EYE[1],
    })
    assert answer.status_code == 422


def test_a_quick_picture_is_drawn_in_one_turn_and_cut_to_the_band(client, monkeypatch):
    from azimut.engine import horizon

    turns = []
    real = horizon.sweep

    def counting(*args, **kwargs):
        turns.append(kwargs.get("rows") is not None)
        return real(*args, **kwargs)

    monkeypatch.setattr(horizon, "sweep", counting)
    body = _ask(client, step=1.0, far=40_000).json()
    assert turns == [True]  # no probe first
    probed = _ask(client, step=1.0, far=40_000, top=body["elevation"]["top"]).json()
    assert probed["elevation"] == body["elevation"]
    assert probed["depth"] == body["depth"]


def _minute(stamp):
    """Minutes since local midnight of a `localtime.both` instant."""
    hours, minutes = stamp["local"][11:16].split(":")
    return int(hours) * 60 + int(minutes)


def test_on_a_plain_the_sun_comes_out_when_the_almanac_says(client, monkeypatch):
    monkeypatch.setattr(terrain, "tile", Relief(peaks=()))
    terrain.forget_decoded()
    body = client.post("/api/horizon/sky", json={
        "lat": EYE[0], "lon": EYE[1], "date": "2026-03-20", "far": 30_000,
    }).json()
    assert body["step_minutes"] == 2 and len(body["sun"]["azimuth"]) == 24 * 30 + 1
    kinds = [event["kind"] for event in body["sun"]["events"]]
    assert kinds == ["appears", "hides"]
    rise = _minute(body["sun"]["sea_level"]["rise"])
    assert abs(body["sun"]["events"][0]["minute"] - rise) <= 4


def test_a_ridge_in_the_east_puts_sunrise_later(client):
    # the synthetic summit stands 15 km due east, about 9° up from the eye
    body = client.post("/api/horizon/sky", json={
        "lat": EYE[0], "lon": EYE[1], "date": "2026-03-20", "far": 40_000,
    }).json()
    appears = body["sun"]["events"][0]
    assert appears["kind"] == "appears"
    rise = _minute(body["sun"]["sea_level"]["rise"])
    # the sun climbs about 10° an hour here in March: well over half an hour late
    assert appears["minute"] - rise > 30
    assert 80 < appears["azimuth"] < 110
    assert body["zone"]["name"] == "Europe/Paris"


def test_the_sky_refuses_a_date_it_cannot_read(client):
    answer = client.post("/api/horizon/sky", json={"lat": EYE[0], "lon": EYE[1], "date": "8 March"})
    assert answer.status_code == 422
    answer = client.post("/api/horizon/sky", json={"lat": EYE[0], "lon": EYE[1], "zone": "Mars/Base"})
    assert answer.status_code == 422


# -- the tiles the browser's mesh reads, in batches --------------------------------


def _framed(body):
    """The `(length, bytes)` frames of a batch answer, in order."""
    frames, at = [], 0
    while at < len(body):
        (size,) = struct.unpack_from("<I", body, at)
        frames.append(body[at + 4:at + 4 + size])
        at += 4 + size
    return frames


def test_terrain_tiles_come_in_one_answer_in_the_order_asked(client, monkeypatch):
    held = {(5, 1, 2): b"first", (5, 3, 4): b"second!"}
    monkeypatch.setattr(terrain, "tile", lambda z, x, y: (held[(z, x, y)], "", "") if (z, x, y) in held else None)
    answer = client.get("/api/horizon/tiles/terrain", params={"t": "5/3/4,5/9/9,5/1/2"})
    assert answer.status_code == 200
    assert answer.headers["content-type"] == "application/octet-stream"
    assert _framed(answer.content) == [b"second!", b"", b"first"]


def test_a_terrain_tile_that_fails_is_a_gap_not_a_failed_request(client, monkeypatch):
    def tile(z, x, y):
        if x == 1:
            raise terrain.TerrainUnavailable("offline")
        return b"ok", "", ""

    monkeypatch.setattr(terrain, "tile", tile)
    answer = client.get("/api/horizon/tiles/terrain", params={"t": "6/1/1,6/2/1"})
    assert answer.status_code == 200
    assert _framed(answer.content) == [b"", b"ok"]


@pytest.mark.parametrize("t", [
    "", "5/1", "a/b/c", "5/1/2,", "5/-1/2", "15/0/0", "3/8/0", "3/0/8", "5/1/2 ",
])
def test_a_bad_terrain_batch_is_refused_at_the_edge(client, monkeypatch, t):
    monkeypatch.setattr(terrain, "tile", lambda *a: pytest.fail("nothing is fetched"))
    answer = client.get("/api/horizon/tiles/terrain", params={"t": t})
    assert answer.status_code == 422


def test_a_batch_has_a_size_limit(client, monkeypatch):
    from azimut.api import horizon as horizon_api

    monkeypatch.setattr(terrain, "tile", lambda *a: (b"x", "", ""))
    ok = ",".join(f"8/{i}/0" for i in range(horizon_api.TILES_MAX))
    assert client.get("/api/horizon/tiles/terrain", params={"t": ok}).status_code == 200
    too_many = ok + ",8/99/0"
    assert client.get("/api/horizon/tiles/terrain", params={"t": too_many}).status_code == 422


class _Served:
    """Stands for the map's tile helper: what each tile answers, and what was asked."""

    def __init__(self, held):
        self.held, self.calls = held, []

    def __call__(self, provider, z, x, y):
        from fastapi import HTTPException
        from fastapi.responses import Response

        self.calls.append((provider.id, z, x, y))
        if (z, x, y) not in self.held:
            raise HTTPException(status_code=404, detail="no imagery")
        return Response(content=self.held[(z, x, y)], media_type="image/png")


def _sentinel(monkeypatch, blocked=False):
    """A Sentinel-2 provider with a native ceiling of 14, billed per tile."""
    import dataclasses

    from azimut.engine import tiles

    real = tiles.get_provider
    fake = dataclasses.replace(
        real("esri-world-imagery"), id="sentinel2", label="Sentinel-2", meter="sentinel",
        max_zoom=16, max_native_zoom=14,
    )
    monkeypatch.setattr(tiles, "get_provider", lambda pid: fake if pid == "sentinel2" else real(pid))
    from azimut import config

    monkeypatch.setattr(config, "usage_blocked", lambda meter, settings=None: blocked)
    return fake


def test_imagery_tiles_are_served_as_the_map_serves_them(client, monkeypatch):
    from azimut.api import satellite

    served = _Served({(7, 1, 1): b"png-a", (7, 2, 1): b"png-b"})
    monkeypatch.setattr(satellite, "serve_tile", served)
    answer = client.get(
        "/api/horizon/tiles/imagery", params={"provider": "esri-world-imagery", "t": "7/2/1,7/0/0,7/1/1"}
    )
    assert answer.status_code == 200
    assert _framed(answer.content) == [b"png-b", b"", b"png-a"]
    assert [call[0] for call in served.calls] == ["esri-world-imagery"] * 3


def test_imagery_zoom_goes_up_to_the_providers_own_limit(client, monkeypatch):
    from azimut.api import satellite
    from azimut.engine import tiles

    monkeypatch.setattr(satellite, "serve_tile", _Served({}))
    limit = tiles.get_provider("esri-world-imagery").max_zoom
    params = {"provider": "esri-world-imagery"}
    assert client.get("/api/horizon/tiles/imagery", params={**params, "t": f"{limit}/0/0"}).status_code == 200
    assert client.get("/api/horizon/tiles/imagery", params={**params, "t": f"{limit + 1}/0/0"}).status_code == 422


def test_imagery_that_is_not_free_imagery_is_refused(client, monkeypatch):
    from azimut.api import satellite

    monkeypatch.setattr(satellite, "serve_tile", lambda *a: pytest.fail("nothing is fetched"))
    client.put("/api/settings/keys", json={"mapbox": "pk.test"})
    for provider in ("mapbox-satellite", "osm"):
        answer = client.get("/api/horizon/tiles/imagery", params={"provider": provider, "t": "3/1/1"})
        assert answer.status_code == 422, provider
    assert client.get("/api/horizon/tiles/imagery", params={"provider": "nope", "t": "3/1/1"}).status_code == 404


def test_sentinel_2_tiles_are_served_and_a_paused_meter_refuses_the_whole_batch(client, monkeypatch):
    from azimut.api import satellite

    _sentinel(monkeypatch)
    served = _Served({(10, 5, 5): b"s2"})
    monkeypatch.setattr(satellite, "serve_tile", served)
    answer = client.get("/api/horizon/tiles/imagery", params={"provider": "sentinel2", "t": "10/5/5,10/5/6"})
    assert answer.status_code == 200
    assert _framed(answer.content) == [b"s2", b""]

    _sentinel(monkeypatch, blocked=True)
    served.calls.clear()
    paused = client.get("/api/horizon/tiles/imagery", params={"provider": "sentinel2", "t": "10/5/5"})
    assert paused.status_code == 429
    assert served.calls == []


def test_the_estimate_counts_the_uncached_tiles_inside_the_disc(client, monkeypatch):
    from azimut.engine import tilecache

    fake = _sentinel(monkeypatch)
    asked = []

    def has(provider_id, z, x, y):
        asked.append((provider_id, z, x, y))
        return x % 2 == 0

    monkeypatch.setattr(tilecache, "has", has)
    body = {"lat": 45.0, "lon": 6.0, "near_provider": "sentinel2", "near_reach": 5000}
    answer = client.post("/api/horizon/tiles/estimate", json=body)
    assert answer.status_code == 200, answer.text
    counted = answer.json()
    # z14 tiles are about 1.7 km wide at 45 degrees: a 5 km radius touches a few dozen
    assert 25 <= counted["tiles"] <= 45
    assert {key[0] for key in asked} == {fake.id}
    assert {key[1] for key in asked} == {14}
    assert counted["requests"] == sum(1 for key in asked if key[2] % 2 == 1)
    assert 0 < counted["requests"] < counted["tiles"]
    # a wider disc touches more tiles
    wider = client.post("/api/horizon/tiles/estimate", json={**body, "near_reach": 10000}).json()
    assert wider["tiles"] > counted["tiles"]
    # tiles all on disk: nothing would be asked
    monkeypatch.setattr(tilecache, "has", lambda *a: True)
    assert client.post("/api/horizon/tiles/estimate", json=body).json()["requests"] == 0


def test_the_estimate_asks_nothing_of_the_network_and_works_while_paused(client, monkeypatch):
    from azimut.api import satellite
    from azimut.engine import tilecache

    _sentinel(monkeypatch, blocked=True)
    monkeypatch.setattr(satellite, "serve_tile", lambda *a: pytest.fail("nothing is fetched"))
    monkeypatch.setattr(tilecache, "has", lambda *a: False)
    body = {"lat": 45.0, "lon": 6.0, "near_provider": "sentinel2"}
    answer = client.post("/api/horizon/tiles/estimate", json=body)
    assert answer.status_code == 200
    assert answer.json()["requests"] == answer.json()["tiles"] > 0


def test_the_estimate_refuses_what_is_not_sentinel_2_or_out_of_range(client, monkeypatch):
    _sentinel(monkeypatch)
    body = {"lat": 45.0, "lon": 6.0, "near_provider": "esri-world-imagery"}
    assert client.post("/api/horizon/tiles/estimate", json=body).status_code == 422
    sentinel = {**body, "near_provider": "sentinel2"}
    assert client.post("/api/horizon/tiles/estimate", json={**sentinel, "near_reach": 100}).status_code == 422
    assert client.post("/api/horizon/tiles/estimate", json={**sentinel, "near_reach": 99_000}).status_code == 422


# -- the photo laid over the view ------------------------------------------------


def _photo_bytes(size=(400, 300), focal35=26, gps=True, taken="2024:06:12 14:31:00"):
    """A JPEG that says its lens, where and when, as a phone writes them."""
    import io
    from fractions import Fraction

    from PIL import Image
    from PIL.TiffImagePlugin import IFDRational

    exif = Image.Exif()
    camera = exif.get_ifd(0x8769)
    camera[0x920A] = IFDRational(6, 1)
    if focal35:
        camera[0xA405] = focal35
    if taken:
        camera[36867] = taken
    if gps:
        exif.get_ifd(0x8825).update({
            1: "N", 2: tuple(Fraction(v) for v in (46, 33, 31)),
            3: "E", 4: tuple(Fraction(v) for v in (7, 50, 7)),
        })
    out = io.BytesIO()
    Image.new("RGB", size, (90, 120, 160)).save(out, "JPEG", exif=exif)
    return out.getvalue()


def _case_with(client, name, data, case="Overlay"):
    import io

    case_id = client.post("/api/cases", json={"name": case}).json()["id"]
    item = client.post(
        f"/api/cases/{case_id}/media/upload", files={"file": (name, io.BytesIO(data), "application/octet-stream")}
    ).json()["item"]
    return case_id, item["path"]


def test_a_case_photo_says_its_lens_place_and_time(client):
    case_id, path = _case_with(client, "summit.jpg", _photo_bytes())
    answer = client.get("/api/horizon/photo", params={"case": case_id, "path": path})
    assert answer.status_code == 200, answer.text
    facts = answer.json()
    assert facts["kind"] == "image"
    assert (facts["width"], facts["height"]) == (400, 300)
    assert facts["focal35_mm"] == 26.0
    assert facts["gps"]["lat"] == pytest.approx(46.5586, abs=1e-3)
    assert facts["gps"]["lon"] == pytest.approx(7.8353, abs=1e-3)
    # the camera's own clock, with no zone claimed
    assert facts["taken_at"] == "2024-06-12T14:31:00"


def test_a_photo_that_says_nothing_is_offered_nothing(client):
    case_id, path = _case_with(client, "plain.jpg", _photo_bytes(focal35=None, gps=False, taken=None))
    facts = client.get("/api/horizon/photo", params={"case": case_id, "path": path}).json()
    assert "focal35_mm" not in facts and "gps" not in facts and "taken_at" not in facts
    assert facts["focal_mm"] == 6.0


def test_the_photo_route_stays_inside_the_case(client):
    case_id, _ = _case_with(client, "summit.jpg", _photo_bytes())
    assert client.get("/api/horizon/photo", params={"case": case_id, "path": "../../settings.json"}).status_code == 403
    assert client.get("/api/horizon/photo", params={"case": case_id, "path": "media/none.jpg"}).status_code == 404
    case_id, path = _case_with(client, "notes.txt", b"not a photo", case="Notes")
    assert client.get("/api/horizon/photo", params={"case": case_id, "path": path}).status_code == 422


def test_a_photo_on_the_computer_is_read_from_its_head_and_forgotten(client, tmp_workspace):
    from azimut.api import horizon as horizon_api

    data = _photo_bytes()
    head = base64.b64encode(data[: horizon_api.PHOTO_HEAD_BYTES]).decode()
    answer = client.post("/api/horizon/photo", json={"head": head})
    assert answer.status_code == 200, answer.text
    assert answer.json()["focal35_mm"] == 26.0
    # a head cut short of the frame still says what came before it
    cut = base64.b64encode(data[:2000]).decode()
    assert client.post("/api/horizon/photo", json={"head": cut}).status_code == 200
    assert client.post("/api/horizon/photo", json={"head": "not base64!"}).status_code == 422
    # bounded where it is read: a whole file is refused
    whole = "A" * (horizon_api.PHOTO_HEAD_CHARS + 4)
    assert client.post("/api/horizon/photo", json={"head": whole}).status_code == 422
