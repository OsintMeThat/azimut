"""The buildings service: what it fetches, when, what it keeps and what it says."""

from __future__ import annotations

import pytest

from azimut.engine.buildings import globfp, ign, model, osm, service, wire

LAT, LON = 45.7578, 4.8320
KEY = model.tile_of(LAT, LON)
GRID = globfp.Grid("9999_4.0_45.0_5.25_46.25_FR.zip", 4.0, 45.0, 5.25, 46.25, 1, 51_000_000)


def house(lat: float, lon: float, *, height: float | None, kind: str, source: str, date: str = "") -> model.Building:
    d = 0.00006  # about 5 to 7 m
    ring = ((lon - d, lat - d), (lon + d, lat - d), (lon + d, lat + d), (lon - d, lat + d))
    return model.Building(rings=(ring,), height=height, kind=kind, source=source, date=date)  # type: ignore[arg-type]


class Sources:
    """Stand-ins for the three sources, counting what is asked of them."""

    def __init__(self, monkeypatch, *, ign_covers=True, osm_fails=False, grid_ready=False):
        self.calls: list[tuple[str, model.Key]] = []
        self.grid_ready = grid_ready
        self.downloads = 0
        monkeypatch.setattr(ign, "covers", lambda z, x, y: ign_covers)
        monkeypatch.setattr(ign, "fetch_tile", self._ign)
        monkeypatch.setattr(osm, "fetch_tile", self._osm_failing if osm_fails else self._osm)
        monkeypatch.setattr(globfp, "grids_for_tile", lambda z, x, y: [GRID])
        monkeypatch.setattr(globfp, "is_ready", lambda grid: self.grid_ready)
        monkeypatch.setattr(globfp, "needed", lambda z, x, y: [] if self.grid_ready else [GRID])
        monkeypatch.setattr(globfp, "all_grids", lambda: [GRID])
        monkeypatch.setattr(globfp, "download", self._download)
        monkeypatch.setattr(globfp, "read_tile", self._globfp)

    def _here(self, z: int, x: int, y: int) -> bool:
        return (z, x, y) == KEY

    def _ign(self, z, x, y):
        self.calls.append(("ign", (z, x, y)))
        return [house(LAT, LON, height=18.6, kind="measured", source="ign", date="2022-08-10")] if self._here(z, x, y) else []

    def _osm(self, z, x, y):
        self.calls.append(("osm", (z, x, y)))
        return [house(LAT, LON, height=None, kind="unknown", source="osm", date="2026-10-04")] if self._here(z, x, y) else []

    def _osm_failing(self, z, x, y):
        self.calls.append(("osm", (z, x, y)))
        raise model.BuildingsUnavailable("OpenStreetMap buildings could not be read just now (timeout)")

    def _globfp(self, z, x, y):
        self.calls.append(("globfp", (z, x, y)))
        return [house(LAT, LON, height=9.5, kind="estimated", source="globfp", date="2020")] if self._here(z, x, y) else []

    def _download(self, grid, progress=None, cancelled=None):
        self.downloads += 1
        if progress:
            progress(grid.size, grid.size)
        self.grid_ready = True


@pytest.fixture(autouse=True)
def fresh(tmp_workspace):
    service.forget()
    yield
    service.wait_idle()
    service.forget()


def settled(sources=None, radius=500.0):
    """Ask until every tile is in, as the view's polling would."""
    for _ in range(50):
        answer = service.status(LAT, LON, radius, sources)
        service.wait_idle()
        if answer["pending"] == 0 and not any(d["done"] < d["total"] for d in answer["downloads"]):
            return service.status(LAT, LON, radius, sources)
    raise AssertionError("the area never settled")


def test_the_tiles_round_an_eye_are_nearest_first_and_bounded():
    keys = service.tiles_around(LAT, LON, 2000)
    assert keys[0] == KEY
    assert 4 <= len(keys) <= 16
    assert len(service.tiles_around(LAT, LON, 1e9)) <= service.MAX_TILES
    assert service.tiles_around(LAT, LON, 0) == [KEY]


def test_nothing_is_asked_until_the_area_is(monkeypatch):
    sources = Sources(monkeypatch)
    assert sources.calls == [] and sources.downloads == 0


def test_the_area_fills_from_the_quick_sources_and_says_where_each_height_comes_from(monkeypatch):
    Sources(monkeypatch)
    answer = settled()
    assert answer["counts"]["measured"] == 1
    assert answer["footprints"] == {"ign": 1}
    ign_source = next(s for s in answer["sources"] if s["id"] == "ign")
    assert ign_source["licence"] == "Licence Ouverte 2.0" and ign_source["newest"] == "2022-08-10"
    # 3D-GloBFP waits for the analyst, with its size in front of them
    assert answer["needs"] == [{"grid": GRID.name, "size": GRID.size}]


def test_a_source_is_read_once_then_from_the_workspace(monkeypatch):
    sources = Sources(monkeypatch)
    settled()
    asked = len(sources.calls)
    service.forget()
    settled()
    assert len(sources.calls) == asked


def test_a_failing_source_is_said_and_the_tile_is_drawn_from_the_others(monkeypatch):
    Sources(monkeypatch, ign_covers=False, osm_fails=True, grid_ready=True)
    answer = settled()
    assert answer["failed"] == [{"source": "osm", "reason": "OpenStreetMap buildings could not be read just now (timeout)"}]
    assert answer["retry_in"] > 0
    assert answer["counts"]["estimated"] == 1
    assert answer["footprints"] == {"globfp": 1}


def test_a_failed_tile_is_not_asked_again_at_once(monkeypatch):
    sources = Sources(monkeypatch, ign_covers=False, osm_fails=True, grid_ready=True)
    settled()
    asked = sum(1 for source, _ in sources.calls if source == "osm")
    settled()
    assert sum(1 for source, _ in sources.calls if source == "osm") == asked


def test_a_grid_downloads_only_once_the_analyst_agrees_and_the_tile_is_drawn_again(monkeypatch):
    sources = Sources(monkeypatch, ign_covers=False)
    before = settled()
    assert sources.downloads == 0
    assert before["counts"] == {"measured": 0, "estimated": 0, "range": 0, "unknown": 1}
    version = next(t["version"] for t in before["tiles"] if t["key"] == service.key_text(KEY))
    assert service.allow([GRID.name, "not-a-grid.zip"]) == [GRID.name]
    after = settled()
    assert sources.downloads == 1
    assert after["needs"] == [] and after["downloads"] == []
    # the OSM house now carries 3D-GloBFP's estimate, and its tile a new version
    assert after["counts"]["estimated"] == 1 and after["counts"]["unknown"] == 0
    assert next(t["version"] for t in after["tiles"] if t["key"] == service.key_text(KEY)) != version


def test_a_failed_download_is_said_and_may_be_asked_again(monkeypatch):
    sources = Sources(monkeypatch, ign_covers=False)

    def refuse(grid, progress=None, cancelled=None):
        raise model.BuildingsUnavailable("3D-GloBFP answered HTTP 503 for the grid")

    monkeypatch.setattr(globfp, "download", refuse)
    service.allow([GRID.name])
    service.wait_idle()
    answer = service.status(LAT, LON, 500)
    assert answer["downloads"][0]["error"] == "3D-GloBFP answered HTTP 503 for the grid"
    assert answer["needs"] == [{"grid": GRID.name, "size": GRID.size}]
    monkeypatch.setattr(globfp, "download", sources._download)
    assert service.allow([GRID.name]) == [GRID.name]
    assert settled()["counts"]["estimated"] == 1


def test_ready_tiles_come_as_bytes_the_view_reads_and_others_as_nothing(monkeypatch):
    Sources(monkeypatch)
    settled()
    far = (model.ZOOM, KEY[1] + 40, KEY[2])
    got = service.tile_bytes([KEY, far])
    buildings = wire.decode(got[KEY], *KEY)
    assert [(b.source, b.kind) for b in buildings] == [("ign", "measured")]
    assert buildings[0].height == pytest.approx(18.6, abs=1e-5)  # sent as a 32-bit float
    # the far tile was only asked now: it is not in yet
    assert got[far] is None


def test_a_switched_off_source_is_neither_read_nor_drawn(monkeypatch):
    sources = Sources(monkeypatch)
    answer = settled(sources=["osm"])
    assert {source for source, _ in sources.calls} == {"osm"}
    assert answer["needs"] == [] and answer["footprints"] == {"osm": 1}


def test_the_building_under_a_point_says_whose_footprint_and_whose_height(monkeypatch):
    Sources(monkeypatch, ign_covers=False, grid_ready=True)
    settled()
    found = service.building_at(LAT, LON)
    assert found is not None
    assert (found["source"], found["height_source"], found["height"], found["kind"]) == ("osm", "globfp", 9.5, "estimated")
    assert (found["date"], found["height_date"]) == ("2026-10-04", "2020")
    assert service.building_at(LAT + 0.001, LON) is None


def test_clearing_forgets_every_tile_kept(monkeypatch):
    sources = Sources(monkeypatch)
    settled()
    assert service.clear() > 0
    asked = len(sources.calls)
    settled()
    assert len(sources.calls) > asked


def test_the_sweep_holds_the_tile_files_under_their_budget(monkeypatch):
    Sources(monkeypatch)
    settled(radius=2000)
    files = list((model.cache_root() / "tiles").rglob("*.json.gz"))
    assert len(files) > 4
    freed = service.sweep(tiles_budget=1)
    assert freed > 0
    assert len(list((model.cache_root() / "tiles").rglob("*.json.gz"))) < len(files)


def test_where_the_ign_has_surveyed_the_tile_no_grid_is_offered(monkeypatch):
    sources = Sources(monkeypatch)
    answer = settled()
    # the IGN covers and fills the eye's tile: only the empty tiles round it may ask for the grid
    assert answer["needs"] == [{"grid": GRID.name, "size": GRID.size}]
    assert ("globfp", KEY) not in sources.calls
    lone = settled(radius=100)
    assert lone["needs"] == []


def test_a_point_read_off_a_wall_finds_its_building(monkeypatch):
    Sources(monkeypatch, ign_covers=False, grid_ready=True)
    settled()
    # the house is about 6.5 m from its middle to its east wall: 1 m past the wall still finds it
    kx, _ky = model.metres_frame(LAT)
    assert service.building_at(LAT, LON + 7.5 / kx) is not None
    assert service.building_at(LAT, LON + 15.0 / kx) is None
