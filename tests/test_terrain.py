"""Terrain heights: tiles, the disk cache, the fallback source and sampling."""

import io
import os
import time

import httpx
import numpy as np
import pytest
from PIL import Image

from azimut import config
from azimut.engine import terrain, tiles


@pytest.fixture(autouse=True)
def fresh_terrain(monkeypatch):
    """No test sees another's decoded tiles, and a retry never waits."""
    terrain.forget_decoded()
    monkeypatch.setattr(tiles, "RETRY_PAUSE", 0)
    yield
    terrain.forget_decoded()


def _webp(heights: np.ndarray) -> bytes:
    """A lossless terrarium WebP, the way Mapterhorn serves it."""
    rgb = np.asarray(Image.open(io.BytesIO(terrain.encode(heights))).convert("RGB"))
    buffer = io.BytesIO()
    Image.fromarray(rgb, "RGB").save(buffer, format="WEBP", lossless=True)
    return buffer.getvalue()


def _network(monkeypatch, handler):
    """Route the terrain client through `handler`, counting what it is asked."""
    asked: list[str] = []

    def counting(request: httpx.Request) -> httpx.Response:
        asked.append(str(request.url))
        return handler(request)

    monkeypatch.setattr(
        terrain, "_client_instance", httpx.Client(transport=httpx.MockTransport(counting))
    )
    return asked


def _linear_fetch(scale: float):
    """Tiles whose height is `scale` × the global pixel column: bilinear reads it exactly."""
    def fetch(z, x, y):
        columns = x * terrain.TILE + np.arange(terrain.TILE, dtype=np.float64)
        heights = np.broadcast_to(columns * scale, (terrain.TILE, terrain.TILE))
        return terrain.encode(heights), "image/png", terrain.MAPTERHORN.id
    return fetch


# -- encoding ------------------------------------------------------------------


def test_terrarium_round_trips_to_a_hundredth_of_a_metre():
    heights = np.linspace(-430.0, 8848.86, terrain.TILE * terrain.TILE).reshape(
        terrain.TILE, terrain.TILE
    )
    assert np.abs(terrain.decode(terrain.encode(heights)) - heights).max() < 0.01


def test_the_sea_tile_is_flat_at_zero():
    assert np.all(terrain.decode(terrain.sea_tile()) == 0)


def test_an_unreadable_tile_is_unavailable_not_a_crash():
    with pytest.raises(terrain.TerrainUnavailable):
        terrain.decode(b"<html>error</html>")


# -- geometry ------------------------------------------------------------------


def test_destination_and_distance_agree():
    lat, lon = terrain.destination(45.8, 6.86, 73.0, 41_250.0)
    assert terrain.distance(45.8, 6.86, float(lat), float(lon)) == pytest.approx(41_250.0, abs=0.01)
    assert terrain.bearing(45.8, 6.86, float(lat), float(lon)) == pytest.approx(73.0, abs=1e-6)


def test_destination_wraps_the_antimeridian():
    _lat, lon = terrain.destination(0.0, 179.9, 90.0, 50_000.0)
    assert -180.0 <= float(lon) < -179.0


def test_zoom_for_picks_the_coarsest_level_fine_enough():
    zoom = terrain.zoom_for(100.0, 46.0)
    assert terrain.metres_per_pixel(46.0, zoom) <= 100.0 < terrain.metres_per_pixel(46.0, zoom - 1)
    assert terrain.zoom_for(0.01, 46.0) == terrain.MAX_ZOOM


# -- sampling ------------------------------------------------------------------


def test_bilinear_heights_are_exact_on_a_linear_field_across_tile_edges():
    rng = np.random.default_rng(7)
    lat = rng.uniform(-60, 60, 2000)
    lon = rng.uniform(-170, 170, 2000)
    sampler = terrain.Sampler(fetch=_linear_fetch(10.0))
    got = sampler.heights(lat, lon, 2)
    px, _py = terrain._pixels(lat, lon, 2)
    assert np.abs(got - px * 10.0).max() < 0.05
    assert sampler.zooms == {2}
    assert sampler.sources == {terrain.MAPTERHORN.id}


def test_a_missing_survey_climbs_to_the_planet_level():
    planet = _linear_fetch(0.001)

    def fetch(z, x, y):
        return None if z > terrain.PLANET_ZOOM else planet(z, x, y)

    sampler = terrain.Sampler(fetch=fetch)
    got = sampler.heights(46.5, 8.0, terrain.MAX_ZOOM)
    px, _py = terrain._pixels(np.array([46.5]), np.array([8.0]), terrain.PLANET_ZOOM)
    assert float(got) == pytest.approx(float(px[0]) * 0.001, abs=0.01)
    assert sampler.zooms == {terrain.PLANET_ZOOM}
    assert sampler.resolution(46.5) == pytest.approx(
        terrain.metres_per_pixel(46.5, terrain.PLANET_ZOOM), abs=0.1
    )


def _patchy_fetch():
    """A field with a survey only on even tile columns past the planet level, and
    a sea tile here and there below it: every branch of a read in one place."""
    rng = np.random.default_rng(3)
    cache: dict = {}

    def fetch(z, x, y):
        if z > terrain.PLANET_ZOOM and x % 2:
            return None
        if z <= terrain.PLANET_ZOOM and (x + y) % 7 == 0:
            return None
        if (z, x, y) not in cache:
            heights = rng.uniform(0, 3000, (terrain.TILE, terrain.TILE)).astype(np.float32)
            cache[(z, x, y)] = (terrain.encode(heights), "image/png", terrain.MAPTERHORN.id)
        return cache[(z, x, y)]

    return fetch


def test_a_wide_read_off_laid_out_tiles_matches_the_tile_by_tile_one(monkeypatch):
    fetch = _patchy_fetch()
    rng = np.random.default_rng(11)
    # a ring of points a few kilometres around a Swiss eye, as a panorama band reads
    lat, lon = terrain.destination(
        46.55, 7.83, rng.uniform(0, 360, 20000), rng.uniform(200, 9000, 20000)
    )
    laid = terrain.Sampler(fetch=fetch)
    got = laid.heights(lat, lon, terrain.MAX_ZOOM)
    monkeypatch.setattr(terrain, "MOSAIC_MIN_POINTS", 10**9)
    one_by_one = terrain.Sampler(fetch=fetch)
    expected = one_by_one.heights(lat, lon, terrain.MAX_ZOOM)
    assert np.array_equal(got, expected)
    assert laid.zooms == one_by_one.zooms
    assert len(laid.zooms) > 1  # the read did climb where the survey stops


def test_a_wide_read_across_the_antimeridian_reads_as_the_tile_by_tile_one(monkeypatch):
    rng = np.random.default_rng(5)
    lat = rng.uniform(-10, 10, 8000)
    lon = rng.choice([-179.999, 179.999], 8000) + rng.uniform(-0.0005, 0.0005, 8000)
    got = terrain.Sampler(fetch=_linear_fetch(1.0)).heights(lat, lon, 6)
    monkeypatch.setattr(terrain, "MOSAIC_MIN_POINTS", 10**9)
    expected = terrain.Sampler(fetch=_linear_fetch(1.0)).heights(lat, lon, 6)
    assert np.array_equal(got, expected)


def test_the_sea_reads_as_zero_and_credits_nobody():
    sampler = terrain.Sampler(fetch=lambda z, x, y: None)
    assert np.all(sampler.heights([10.0, -20.0], [-150.0, -100.0], terrain.PLANET_ZOOM) == 0)
    assert sampler.credits() == []


def test_a_sampler_loads_each_tile_once():
    calls: list[tuple[int, int, int]] = []
    linear = _linear_fetch(1.0)

    def fetch(z, x, y):
        calls.append((z, x, y))
        return linear(z, x, y)

    sampler = terrain.Sampler(fetch=fetch)
    sampler.heights(np.full(50, 46.0), np.linspace(7.0, 7.01, 50), 10)
    sampler.heights(46.0, 7.005, 10)
    assert len(calls) == len(set(calls))


def test_a_profile_is_evenly_spaced_and_reads_a_level_matching_its_spacing():
    sampler = terrain.Sampler(fetch=_linear_fetch(0.001))
    along, lat, lon, heights, _ = terrain.profile([(45.8, 6.8), (46.0, 7.6)], 101, sampler)
    total = terrain.distance(45.8, 6.8, 46.0, 7.6)
    assert along[-1] == pytest.approx(total)
    assert np.allclose(np.diff(along), total / 100)
    assert (float(lat[-1]), float(lon[-1])) == pytest.approx((46.0, 7.6), abs=1e-6)
    zoom = next(iter(sampler.zooms))
    assert terrain.metres_per_pixel(45.9, zoom) <= total / 100 / 2


def test_a_profile_follows_every_leg_of_a_path():
    path = [(45.0, 6.0), (45.0, 6.1), (45.1, 6.1)]
    along, lat, lon, _h, _s = terrain.profile(path, 41, terrain.Sampler(fetch=_linear_fetch(0.0)))
    legs = terrain.distance(*path[0], *path[1]) + terrain.distance(*path[1], *path[2])
    assert along[-1] == pytest.approx(legs)
    corner = int(np.argmin(np.hypot(lat - 45.0, lon - 6.1)))
    assert (float(lat[corner]), float(lon[corner])) == pytest.approx((45.0, 6.1), abs=2e-3)


# -- fetching and the cache ----------------------------------------------------


def test_a_tile_is_fetched_once_then_read_from_the_workspace(tmp_workspace, monkeypatch):
    body = _webp(np.full((terrain.TILE, terrain.TILE), 1234.0))
    asked = _network(monkeypatch, lambda request: httpx.Response(
        200, content=body, headers={"content-type": "image/webp"}))
    first = terrain.tile(12, 2133, 1446)
    second = terrain.tile(12, 2133, 1446)
    assert first == second == (body, "image/webp", "mapterhorn")
    assert asked == ["https://tiles.mapterhorn.com/12/2133/1446.webp"]
    assert (config.terrain_cache_dir() / "mapterhorn" / "12" / "2133_1446.webp").is_file()


def test_a_tile_that_does_not_exist_is_remembered(tmp_workspace, monkeypatch):
    asked = _network(monkeypatch, lambda request: httpx.Response(404, text="Not found"))
    assert terrain.tile(12, 100, 2000) is None
    assert terrain.tile(12, 100, 2000) is None
    assert len(asked) == 1


def test_a_forgotten_absence_is_asked_again_after_its_month(tmp_workspace, monkeypatch):
    asked = _network(monkeypatch, lambda request: httpx.Response(404, text="Not found"))
    terrain.tile(13, 5800, 3240)
    marker = config.terrain_cache_dir() / "none" / "13" / "5800_3240"
    old = time.time() - (terrain.NONE_TTL_DAYS + 1) * 86400
    os.utime(marker, (old, old))
    terrain.tile(13, 5800, 3240)
    assert len(asked) == 2


def test_an_unreachable_mapterhorn_falls_back_to_four_aws_tiles(tmp_workspace, monkeypatch):
    quarters = {}
    for dy in (0, 1):
        for dx in (0, 1):
            quarters[(2 * 10 + dx, 2 * 20 + dy)] = 100.0 * (1 + dx + 2 * dy)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "tiles.mapterhorn.com":
            raise httpx.ConnectError("down", request=request)
        z, x, y = (int(part) for part in request.url.path.removesuffix(".png").split("/")[-3:])
        assert z == 6
        heights = np.full((256, 256), quarters[(x, y)], dtype=np.float32)
        heights[0, 0] = -3000.0  # sea floor
        return httpx.Response(200, content=terrain.encode(heights),
                              headers={"content-type": "image/png"})

    asked = _network(monkeypatch, handler)
    content, media_type, source = terrain.tile(5, 10, 20)
    assert (media_type, source) == ("image/png", "aws-terrain")
    stitched = terrain.decode(content)
    assert stitched.shape == (512, 512)
    assert stitched[10, 10] == pytest.approx(100.0)
    assert stitched[10, 300] == pytest.approx(200.0)
    assert stitched[300, 10] == pytest.approx(300.0)
    assert stitched[300, 300] == pytest.approx(400.0)
    assert stitched[0, 0] == 0.0  # clamped to the sea surface
    assert sum("amazonaws" in url for url in asked) == 4
    before = len(asked)
    assert terrain.tile(5, 10, 20)[2] == "aws-terrain"
    assert len(asked) == before


def test_both_sources_down_is_unavailable(tmp_workspace, monkeypatch):
    def handler(request):
        raise httpx.ConnectError("offline", request=request)

    _network(monkeypatch, handler)
    with pytest.raises(terrain.TerrainUnavailable):
        terrain.tile(12, 1, 1)


def test_a_transient_failure_is_asked_again(tmp_workspace, monkeypatch):
    answers = iter([httpx.Response(503), httpx.Response(
        200, content=_webp(np.zeros((512, 512))), headers={"content-type": "image/webp"})])
    asked = _network(monkeypatch, lambda request: next(answers))
    assert terrain.tile(3, 1, 1)[2] == "mapterhorn"
    assert len(asked) == 2


def test_the_sweep_keeps_the_cache_under_budget_dropping_the_least_recently_read(tmp_workspace):
    root = config.terrain_cache_dir() / "mapterhorn" / "12"
    root.mkdir(parents=True)
    now = time.time()
    for i in range(10):
        path = root / f"{i}_0.webp"
        path.write_bytes(b"x" * 1000)
        os.utime(path, (now - 1000 + i, now - 1000 + i))
    dropped = terrain.sweep(budget=5000, now=now)
    left = sorted(p.name for p in root.iterdir())
    assert dropped == 6
    assert left == ["6_0.webp", "7_0.webp", "8_0.webp", "9_0.webp"]


def test_the_sweep_forgets_stale_absences_and_keeps_fresh_ones(tmp_workspace):
    folder = config.terrain_cache_dir() / "none" / "12"
    folder.mkdir(parents=True)
    stale, fresh = folder / "1_1", folder / "2_2"
    stale.write_bytes(b"")
    fresh.write_bytes(b"")
    old = time.time() - (terrain.NONE_TTL_DAYS + 1) * 86400
    os.utime(stale, (old, old))
    assert terrain.sweep() == 1
    assert fresh.exists() and not stale.exists()


def test_reading_a_cached_tile_marks_it_recent(tmp_workspace, monkeypatch):
    body = _webp(np.zeros((512, 512)))
    _network(monkeypatch, lambda request: httpx.Response(
        200, content=body, headers={"content-type": "image/webp"}))
    terrain.tile(4, 1, 1)
    path = config.terrain_cache_dir() / "mapterhorn" / "4" / "1_1.webp"
    old = time.time() - 10_000
    os.utime(path, (old, old))
    terrain.tile(4, 1, 1)
    assert path.stat().st_mtime > old + 5000


# -- the API -------------------------------------------------------------------


def test_the_api_names_the_tiles_and_who_to_credit(client):
    body = client.get("/api/terrain/sources").json()
    assert body["tiles"] == "/api/terrain/tiles/{z}/{x}/{y}"
    assert (body["tile_size"], body["max_zoom"], body["encoding"]) == (512, 12, "terrarium")
    assert [s["id"] for s in body["sources"]] == ["mapterhorn", "aws-terrain"]
    assert body["sources"][0]["attribution"] == "© Mapterhorn"


def test_the_tile_route_serves_the_sea_as_a_flat_tile(client, monkeypatch):
    _network(monkeypatch, lambda request: httpx.Response(404, text="Not found"))
    response = client.get("/api/terrain/tiles/12/100/2000")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert "max-age" in response.headers["cache-control"]
    assert np.all(terrain.decode(response.content) == 0)


def test_the_tile_route_passes_a_tile_through(client, monkeypatch):
    body = _webp(np.full((512, 512), 500.0))
    _network(monkeypatch, lambda request: httpx.Response(
        200, content=body, headers={"content-type": "image/webp"}))
    response = client.get("/api/terrain/tiles/12/2133/1446")
    assert (response.status_code, response.content) == (200, body)
    assert response.headers["content-type"] == "image/webp"


@pytest.mark.parametrize("path", ["13/0/0", "-1/0/0", "3/8/0", "3/0/8", "3/-1/0"])
def test_the_tile_route_refuses_what_is_off_the_grid(client, path):
    assert client.get(f"/api/terrain/tiles/{path}").status_code == 422


def test_the_tile_route_says_when_terrain_is_out_of_reach(client, monkeypatch):
    def handler(request):
        raise httpx.ConnectError("offline", request=request)

    _network(monkeypatch, handler)
    response = client.get("/api/terrain/tiles/5/1/1")
    assert response.status_code == 502
    assert response.json()["detail"].startswith("Terrain could not be loaded")


def test_the_elevation_route_reads_one_point(client, monkeypatch):
    body = _webp(np.full((512, 512), 3967.25))
    _network(monkeypatch, lambda request: httpx.Response(
        200, content=body, headers={"content-type": "image/webp"}))
    answer = client.get("/api/terrain/elevation", params={"lat": 46.5776, "lon": 8.0053}).json()
    assert answer["elevation"] == pytest.approx(3967.2, abs=0.1)
    assert answer["resolution_m"] == pytest.approx(
        terrain.metres_per_pixel(46.5776, terrain.MAX_ZOOM), abs=0.1)
    assert answer["credits"][0]["label"] == "Mapterhorn"


def test_the_elevation_route_refuses_off_the_map(client):
    assert client.get("/api/terrain/elevation", params={"lat": 89, "lon": 0}).status_code == 422


def test_the_profile_route_reads_a_line(client, monkeypatch):
    body = _webp(np.full((512, 512), 800.0))
    _network(monkeypatch, lambda request: httpx.Response(
        200, content=body, headers={"content-type": "image/webp"}))
    answer = client.post("/api/terrain/profile", json={
        "points": [[45.8, 6.8], [45.9, 6.9]], "samples": 11}).json()
    assert len(answer["distance_m"]) == len(answer["elevation"]) == 11
    assert answer["elevation"] == [800.0] * 11
    assert answer["distance_m"][0] == 0.0


@pytest.mark.parametrize("body", [
    {"points": [[45.8, 6.8]]},
    {"points": [[45.8, 6.8], [95.0, 6.9]]},
    {"points": [[45.8, 6.8], [45.9, 6.9]], "samples": 5000},
])
def test_the_profile_route_refuses_a_bad_line(client, body):
    assert client.post("/api/terrain/profile", json=body).status_code == 422


def test_nothing_asks_for_terrain_until_a_view_needs_it(client, monkeypatch):
    asked = _network(monkeypatch, lambda request: pytest.fail("terrain fetched unasked"))
    client.get("/api/terrain/sources")
    client.get("/api/settings")
    assert asked == []


def test_the_profile_says_the_earth_hides_a_point_10_km_out_from_a_standing_eye(client, monkeypatch):
    # a calm sea: from 1.7 m the horizon is about 5 km off, so a buoy at 10 km
    # is under it, and a 10 m mast there rises back into sight
    _network(monkeypatch, lambda request: httpx.Response(404, text="Not found"))
    line = {"points": [[43.0, 5.0], [43.0, 5.1226]], "samples": 400, "sight": True}
    hidden = client.post("/api/terrain/profile", json=line).json()["sight"]
    assert hidden["visible"] is False and hidden["margin_deg"] < 0
    assert 3_000 < hidden["blocked_at_m"] < 7_000
    mast = client.post("/api/terrain/profile", json={**line, "target_height": 10}).json()["sight"]
    assert mast["visible"] is True
    assert mast["eye_m"] == 1.7 and mast["target_m"] == 10.0
    # the bulge is nothing at the ends and most in the middle
    bulge = mast["bulge_m"]
    assert bulge[0] == 0 and bulge[-1] == 0
    assert max(bulge) == pytest.approx(10_000**2 / 8 / (6_371_008.8 / 0.87), rel=0.02)


def test_a_profile_without_the_question_carries_no_verdict(client, monkeypatch):
    _network(monkeypatch, lambda request: httpx.Response(404, text="Not found"))
    answer = client.post("/api/terrain/profile", json={"points": [[43, 5], [43, 5.1]]}).json()
    assert "sight" not in answer
