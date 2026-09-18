"""Local analyzer behavior, bounds, provenance and persistence boundaries."""

import io
from copy import deepcopy

import numpy as np
import pytest
from PIL import Image

from azimut import config, layout
from azimut.engine import analyzers, tilecache, workqueue
from azimut.engine.analysis_models import (
    BUILTINS,
    METHODS,
    SIZES,
    Parameters,
    Recipe,
    RunInput,
    Zone,
)
from azimut.workspace import Case
from analyzerfixture import (
    BARE,
    CLOUD,
    DARK,
    EDGE,
    PAD,
    SENTINEL_TILE,
    UNSURE,
    VEGETATION,
    WATER,
    at,
    code,
    fire_frame,
    flame,
    glinted_sea,
    hull,
    index_byte,
    index_frame,
    sample_input,
    sea,
    seed,
    seed_images,
    sentinel_input,
    surface,
    zone,
)


@pytest.fixture
def scenario(client, monkeypatch):
    monkeypatch.setattr(workqueue, "start_workers", False)
    ident = client.post("/api/cases", json={"name": "Analyzer tests"}).json()["id"]
    case = Case.open(ident)
    body = sample_input()
    seed_images(body)

    def forbidden(*args, **kwargs):
        raise AssertionError("unexpected network")

    monkeypatch.setattr(analyzers.httpx, "stream", forbidden)
    monkeypatch.setattr(analyzers.sentinel, "band_frame", forbidden)
    monkeypatch.setattr(analyzers.sentinel, "acquisitions", forbidden)
    return case, body


def run(client, case, body):
    result = client.post(f"/api/cases/{case.id}/analysis/runs", json=body)
    assert result.status_code == 200, result.text
    workqueue.drain(case)
    return client.get(f"/api/cases/{case.id}/analysis/runs/{result.json()['id']}").json()


# -- runs, review and evidence ------------------------------------------------------


def test_local_run_keeps_frames_and_review_without_network(client, scenario):
    case, body = scenario
    saved = run(client, case, body)
    assert saved["status"] == "ready", saved
    assert saved["engine_version"] == analyzers.ENGINE_VERSION
    assert saved["count"] == 1
    # two pictures to review and two band products measured
    assert len(saved["frames"]) == 4
    row = saved["results"][0]
    assert row["area"] > 0
    assert row["geometry"]["type"] == "Polygon"
    for frame in saved["frames"].values():
        assert case.resolve_inside(frame["path"]).is_file()
    assert row["review"] == "new"
    endpoint = f"/api/cases/{case.id}/analysis/runs/{saved['id']}/results/{row['id']}"
    assert client.get(endpoint + "/preview").content.startswith(b"\x89PNG")
    promoted = client.post(endpoint + "/promote", json={"title": "Reviewed change"}).json()
    assert promoted["entity"]["type"] == "place"
    assert client.post(endpoint + "/promote", json={"title": "Again"}).json()["entity"]["id"] == promoted["entity"]["id"]
    # Promoted evidence survives deletion of the working analysis.
    assert client.delete(f"/api/cases/{case.id}/analysis/runs/{saved['id']}").status_code == 200
    assert case.resolve_inside(promoted["image"]).is_file()
    assert not case.resolve_inside(layout.analysis_assets_rel(f"runs-{saved['id']}")).exists()


def test_a_candidate_says_how_strong_it_is_in_words_and_units(client, scenario):
    """A percentage of nothing in particular told nobody anything. A candidate
    now carries how far past its threshold it got, and the reading behind it."""
    case, body = scenario
    row = run(client, case, body)["results"][0]
    assert row["strength"] in {"weak", "clear", "strong"}
    assert row["margin"] >= 1
    # 0.30 → 0.10 red, 0.35 → 0.30 near, 0.40 → 0.20 short-wave: the reading is in percent
    assert 10 < row["measure"]["value"] < 25
    assert "signal_score" not in row and "confidence" not in row


def test_keeping_a_candidate_is_the_only_thing_that_reaches_the_case(client, scenario):
    """A sweep proposes; the analyst disposes, one candidate at a time."""
    case, body = scenario
    saved = run(client, case, body)
    row = saved["results"][0]
    places = [e for e in case.list_entities() if e["type"] == "place"]
    assert places == []          # candidates are not places until one is kept
    endpoint = f"/api/cases/{case.id}/analysis/runs/{saved['id']}/results/{row['id']}"

    # Dismissing says so and leaves nothing behind.
    assert client.patch(endpoint, json={"review": "dismissed"}).json()["review"] == "dismissed"
    assert [e for e in case.list_entities() if e["type"] == "place"] == []

    # Keeping is one act: it records the verdict and files the pin together.
    kept = client.post(endpoint + "/promote", json={"title": "Kept candidate"}).json()
    assert client.get(endpoint.rsplit("/results/", 1)[0]).json()["results"][0]["review"] == "kept"
    assert len([e for e in case.list_entities() if e["type"] == "place"]) == 1

    # A kept candidate cannot be quietly re-triaged behind the pin's back.
    assert client.patch(endpoint, json={"review": "dismissed"}).status_code == 409

    # Undoing takes the pin away and gives the candidate back.
    assert client.delete(endpoint + "/promote").json()["result"]["review"] == "new"
    assert case.get_entity(kept["entity"]["id"]) is None
    assert client.patch(endpoint, json={"review": "dismissed"}).status_code == 200


def test_a_candidate_preview_is_enlarged_so_its_pixels_can_be_read(client, scenario):
    """Legibility comes from whole-number nearest-neighbour zoom, not smoothing."""
    case, body = scenario
    saved = run(client, case, body)
    row = saved["results"][0]
    endpoint = f"/api/cases/{case.id}/analysis/runs/{saved['id']}/results/{row['id']}"
    with Image.open(io.BytesIO(client.get(endpoint + "/preview").content)) as preview:
        box = row["parts"][0]["box"]
        crop = max(box[2], box[3]) + 2 * 20
        zoom = round(320 / crop)
        assert zoom > 1
        assert preview.width == 2 * (box[2] + 2 * 20) * zoom + 8
        assert preview.height == (box[3] + 2 * 20) * zoom + 48


def test_a_candidate_across_a_tile_edge_is_one_candidate_with_one_picture(client, scenario):
    """What crossed the seam used to come back as "evidence parts" to page
    through. It is one thing on the ground, so it is one candidate, and its
    preview is the two tiles laid side by side."""
    case, body = scenario
    z, x, y = SENTINEL_TILE
    body["zones"] = [zone(0.5, 0.1, 1.5, 0.9)]
    left, right = surface(), surface()
    left_after, right_after = surface(), surface()
    left_after[at(492, 200, 20, 20)] = code(0.30, 0.35, 0.40)
    right_after[at(0, 200, 20, 20)] = code(0.30, 0.35, 0.40)
    # the padding is the neighbour's pixels, as the provider serves it
    left_after[at(512, 200, PAD, 20)] = code(0.30, 0.35, 0.40)
    right_after[PAD + 200:PAD + 220, PAD - 20:PAD] = code(0.30, 0.35, 0.40)
    seed(body, left, left_after)
    seed(body, right, right_after, tile=(z, x + 1, y))
    saved = run(client, case, body)
    assert saved["status"] == "ready", saved
    assert saved["count"] == 1
    row = saved["results"][0]
    assert len(row["parts"]) == 2
    endpoint = f"/api/cases/{case.id}/analysis/runs/{saved['id']}/results/{row['id']}"
    response = client.get(endpoint + "/preview")
    assert response.status_code == 200
    with Image.open(io.BytesIO(response.content)) as preview:
        # 40 px of candidate across the seam plus the margins, twice, zoomed together
        crop = 40 + 2 * 20
        zoom = round(320 / crop)
        assert preview.width == 2 * crop * zoom + 8


def test_reading_saved_items_never_starts_jobs(client, scenario):
    case, body = scenario
    before = case.list_jobs()
    assert client.get("/api/compare/analyzers").status_code == 200
    for kind in ("zones", "followups", "runs"):
        assert client.get(f"/api/cases/{case.id}/analysis/{kind}").json() == []
    assert case.list_jobs() == before
    area = client.post(f"/api/cases/{case.id}/analysis/zones", json={"title": "Port", "zones": body["zones"]}).json()
    follow = client.post(f"/api/cases/{case.id}/analysis/followups", json=body).json()
    for kind, saved in (("zones", area), ("followups", follow)):
        assert client.get(f"/api/cases/{case.id}/analysis/{kind}/{saved['id']}").status_code == 200
    assert case.list_jobs() == before


def test_recipe_backup_and_duplicate_preserve_builtin(client):
    original = client.get("/api/compare/analyzers").json()["builtins"][0]
    custom = deepcopy(original)
    custom["name"] = "Weekly port check"
    saved = client.post("/api/compare/analyzers", json=custom).json()
    assert saved["id"] != original["id"]
    backup = client.get("/api/settings/export").json()
    client.delete(f"/api/compare/analyzers/{saved['id']}")
    restored = client.post("/api/settings/import", json=backup)
    assert restored.status_code == 200, restored.text
    catalogue = client.get("/api/compare/analyzers").json()
    assert catalogue["custom"] == [saved]
    assert catalogue["builtins"][0] == original


def test_cancelled_run_never_fetches_and_does_not_reappear(client, scenario):
    case, body = scenario
    saved = client.post(f"/api/cases/{case.id}/analysis/runs", json=body).json()
    assert client.post(f"/api/cases/{case.id}/analysis/runs", json=body).status_code == 409
    url = f"/api/cases/{case.id}/analysis/runs/{saved['id']}"
    assert client.delete(url).status_code == 409
    assert client.post(url + "/cancel").json()["status"] == "cancelled"
    workqueue.drain(case)
    assert client.get(url).json()["frames"] == {}
    assert client.delete(url).status_code == 200
    assert client.get(url).status_code == 404


def test_reexecution_uses_preserved_frames_after_tile_cache_loss(client, scenario, monkeypatch):
    case, body = scenario
    first = run(client, case, body)
    monkeypatch.setattr(tilecache, "get", lambda *args: None)
    second = run(client, case, body)
    assert second["status"] == "ready"
    assert first["id"] != second["id"]
    assert first["results"] == second["results"]
    assert first["input"] == second["input"]


def test_missing_offline_frames_fail_without_partial_results(client, scenario):
    case, body = scenario
    body["b"]["date"] = "2026-05-18"
    saved = run(client, case, body)
    assert saved["status"] == "failed"
    assert "offline" in saved["message"]
    assert saved["results"] == []


def test_tile_ceiling_and_source_validation_before_job_creation(client, scenario):
    case, body = scenario
    # The panel prices an area against these numbers, so they are published.
    catalogue = client.get("/api/compare/analyzers").json()
    assert catalogue["max_tiles"] == analyzers.MAX_TILES
    assert catalogue["grid"] == list(analyzers.GRID)
    big = deepcopy(body)
    big["zones"][0]["points"] = [[0, 0], [5, 5]]
    response = client.post(f"/api/cases/{case.id}/analysis/runs", json=big)
    assert response.status_code == 422
    assert "smaller" in response.text
    assert case.list_jobs() == []
    body["b"]["provider"] = "google"
    assert client.post(f"/api/cases/{case.id}/analysis/runs", json=body).status_code == 422


def test_detect_reads_copernicus_only_and_a_wayback_watch_asks_for_a_date(client, scenario):
    case, body = scenario
    old = deepcopy(body)
    old["a"] = {"provider": "esri-wayback", "release": 1}
    old["b"] = {"provider": "esri-wayback", "release": 2}
    response = client.post(f"/api/cases/{case.id}/analysis/runs", json=old)
    assert response.status_code == 422
    assert "dated Sentinel-2" in response.text
    assert case.list_jobs() == []


def test_zone_union_does_not_duplicate_detections(client, scenario):
    case, body = scenario
    first = run(client, case, body)
    body["zones"].append({**body["zones"][0], "id": "overlap"})
    second = run(client, case, body)
    assert second["results"] == first["results"]
    assert second["total"] == first["total"]


def test_a_sweep_keeps_only_the_tiles_that_found_something(client, scenario):
    """What a case stores follows what was found, not how much was swept."""
    case, body = scenario
    z, x, y = SENTINEL_TILE
    body["zones"] = [zone(0.1, 0.1, 1.9, 0.9)]
    seed_images(body, (z, x + 1, y), changed=False)
    saved = run(client, case, body)
    assert saved["status"] == "ready", saved
    assert saved["total"] == 2
    assert saved["count"] == 1
    assert len(saved["frames"]) == 4
    assert {tuple(record["tile"]) for record in saved["frames"].values()} == {(z, x, y)}
    folder = case.resolve_inside(layout.analysis_assets_rel(f"runs-{saved['id']}"))
    assert {path.name for path in folder.iterdir()} == {
        record["path"].rsplit("/", 1)[1] for record in saved["frames"].values()
    }
    for row in saved["results"]:
        for part in row["parts"]:
            for key in part["frames"]:
                assert case.resolve_inside(saved["frames"][key]["path"]).is_file()


def test_a_run_reports_the_share_of_its_areas_that_had_imagery(client, scenario):
    case, body = scenario
    saved = run(client, case, body)
    assert saved["swept"] == 1.0


# -- models, catalogue and saved recipes ----------------------------------------------


@pytest.mark.parametrize("points", [[[0, 0], [0, 1]], [[179, 0], [-179, 1]], [[0, 86], [1, 87]]])
def test_invalid_areas_are_rejected(points):
    with pytest.raises(ValueError):
        Zone(id="zone", points=points)


def test_models_cannot_smuggle_executable_recipes():
    with pytest.raises(ValueError):
        Recipe(name="Bad", method="python", code="anything")
    assert config.DEFAULT_SETTINGS["analyzers"] == []


def test_a_recipe_saved_before_detect_went_copernicus_only_still_loads():
    old = {"id": "custom-1a2b3c4d5e6f", "name": "Harbour", "method": "colour",
           "providers": ["esri-wayback", "sentinel2"],
           "parameters": {"sensitivity": 40, "min_area": 20, "min_score": 0.2, "cleanup": 1,
                          "smoothing": 0, "normalize": True, "index": "ndvi",
                          "direction": "both", "ignore_clouds": True, "ignore_shadows": True,
                          "guess_clouds": False, "cloud_margin": 2, "merge_metres": 0}}
    recipe = Recipe.model_validate(old)
    assert recipe.method == "surface"
    assert recipe.parameters.sensitivity == 40 and recipe.parameters.cloud_margin == 2
    assert Recipe.model_validate({**old, "method": "water_objects"}).method == "vessels"
    assert "providers" not in recipe.model_dump()


def test_every_method_publishes_sizes_and_words_for_its_reading():
    methods = {entry["id"]: entry for entry in METHODS}
    assert set(methods) == {"vessels", "hotspots", "structure", "spots", "surface", "index"}
    for entry in METHODS:
        assert set(entry["sizes"]) == {"small", "medium", "large", "all"}
        for size in entry["sizes"].values():
            Parameters(**size)          # every size is a valid set of parameters
        smaller, larger = entry["sizes"]["small"], entry["sizes"]["large"]
        assert smaller["min_area"] < larger["min_area"]
        # "All" drops nothing for its size, which is the answer to a mark that
        # falls between two bands and is found by neither.
        assert entry["sizes"]["all"]["min_area"] == 0
        assert entry["sizes"]["all"]["max_area"] == 0
        assert "{" in entry["measure"]
    # the fire test rejects cloud itself; everything else can use the mask
    assert [m for m, entry in methods.items() if not entry["clouds"]] == ["hotspots"]
    assert methods["vessels"]["single"] and methods["hotspots"]["single"]
    # a small target is never morphologically cleaned away
    assert all(entry["sizes"]["small"]["cleanup"] == 0 for entry in METHODS)


def test_builtins_cover_big_and_small_things_and_start_at_medium():
    ids = {recipe.id for recipe in BUILTINS}
    assert {"boats", "anomaly", "structures", "impacts", "large-change", "burn-scars",
            "vegetation-loss", "new-water"} <= ids
    for recipe in BUILTINS:
        medium = SIZES[recipe.method]["medium"]
        assert {key: getattr(recipe.parameters, key) for key in medium} == medium, recipe.id
        assert len(recipe.description) < 200, recipe.id


# -- vessels ---------------------------------------------------------------------------


@pytest.fixture
def copernicus(client, monkeypatch):
    monkeypatch.setattr(workqueue, "start_workers", False)
    ident = client.post("/api/cases", json={"name": "Copernicus detectors"}).json()["id"]
    case = Case.open(ident)

    def forbidden(*args, **kwargs):
        raise AssertionError("unexpected network")

    monkeypatch.setattr(analyzers.httpx, "stream", forbidden)
    monkeypatch.setattr(analyzers.sentinel, "band_frame", forbidden)
    return case


def test_vessels_are_found_and_breaking_waves_are_not(client, copernicus):
    """Wave crests are as bright as hulls in the near-infrared. Short-wave
    infrared is where they part: in the calibration scenes hulls stood 28 to 37
    deviations above their sea there, and 90% of wave crests under 3.5."""
    body = sentinel_input("boats")
    water = sea()
    hull(water, 120, 140, 6, 3)
    hull(water, 300, 220, 8, 4)
    hull(water, 200, 400, 6, 3, swir=False)   # a breaking wave
    seed(body, after=water)
    saved = run(client, copernicus, body)
    assert saved["status"] == "ready", saved
    assert saved["count"] == 2, [r["coordinates"] for r in saved["results"]]
    assert {r["phenomenon"] for r in saved["results"]} == {"Vessel candidate"}
    for row in saved["results"]:
        assert row["strength"] == "strong"
        assert row["measure"]["value"] > 2        # times the water around it
    assert len(saved["frames"]) == 2   # the picture reviewed, and the bands measured


def test_a_hull_the_scene_classification_calls_cloud_is_still_a_hull(client, copernicus):
    """Sen2Cor tags white and red hulls as cloud; in Singapore it masked the tankers."""
    body = sentinel_input("boats")
    water = sea()
    hull(water, 250, 250, 8, 4)
    water[at(250, 250, 8, 4)][:, :, 3] = CLOUD
    seed(body, after=water)
    assert run(client, copernicus, body)["count"] == 1


def test_a_coastline_is_not_a_vessel(client, copernicus):
    body = sentinel_input("boats")
    water = sea()
    land = water[at(0, 300, 512, 212)]
    land[:, :, 0], land[:, :, 1], land[:, :, 2], land[:, :, 3] = 150, 150, 64, BARE
    # a bright headland sticking out into the water
    hull(water, 250, 290, 12, 10)
    seed(body, after=water)
    assert run(client, copernicus, body)["count"] == 0


def test_glint_does_not_turn_the_sea_into_land(client, copernicus):
    """Glint puts every band near 0.08 and leaves NDWI on zero, so an index read
    alone called two thirds of the Bab-el-Mandeb dry and the strait became one
    component of land. The classification is asked too, and either saying water
    is enough."""
    body = sentinel_input("boats")
    water = glinted_sea()
    hull(water, 200, 200, 8, 4)
    seed(body, after=water)
    saved = run(client, copernicus, body)
    assert saved["status"] == "ready", saved
    assert saved["count"] == 1, [r["coordinates"] for r in saved["results"]]


def test_sediment_flattens_the_index_and_the_classification_carries_it(client, copernicus):
    """Suspended matter does to the index what glint does: pushes it onto zero.

    The rule is not "this one scene", it is that a weak index is not a dry one.
    """
    body = sentinel_input("boats")
    water = sea()
    water[:, :, 2] = 120                                # NDWI ≈ -0.06, still water
    hull(water, 250, 250, 8, 4)
    seed(body, after=water)
    assert run(client, copernicus, body)["count"] == 1


def test_ground_the_classification_calls_water_is_still_ground(client, copernicus):
    """Sen2Cor calls deep shadow and dark ground water, and taking its word
    there would put vessel candidates on land. It is believed where the index is
    weak, never where the index plainly says dry."""
    body = sentinel_input("boats")
    desert = surface(0.30, 0.35, 0.30, WATER)           # the classification is wrong
    desert[:, :, 2] = 40                                # the index is not: NDWI ≈ -0.7
    roof = desert[at(250, 250, 8, 4)]
    roof[:, :, 0], roof[:, :, 1] = 255, 255             # something bright out there
    seed(body, after=desert)
    assert run(client, copernicus, body)["count"] == 0


def test_vessel_sweep_asks_for_one_date_and_never_for_a_reference(client, copernicus):
    body = sentinel_input("boats")
    water = sea()
    hull(water, 200, 200, 6, 3)
    seed(body, after=water)
    body["a"] = {"provider": "sentinel2", "date": "", "layer": "TRUE_COLOR", "maxcc": 30}
    saved = run(client, copernicus, body)
    assert saved["status"] == "ready", saved
    assert saved["input"]["a"] == saved["input"]["b"]
    assert saved["count"] == 1


def test_local_contrast_reads_a_target_against_its_own_patch_of_sea():
    """The same hull, on calm water and on water twice as bright, reads the same."""
    rng = np.random.default_rng(7)
    calm = np.full((200, 200), 20.0) + rng.normal(0, 1.5, (200, 200))
    water = np.ones((200, 200), bool)
    readings = []
    for patch in (calm, calm + 120):
        empty, share = analyzers.local_contrast(patch, water, 61, 11)
        assert share.min() > 0.99
        assert abs(empty[100, 100]) < 4
        target = patch.copy()
        target[99:102, 99:102] += 100
        contrast, _ = analyzers.local_contrast(target, water, 61, 11)
        readings.append(contrast[100, 100])
    assert min(readings) > 20
    assert abs(readings[0] - readings[1]) < 5


def test_local_contrast_treats_land_in_the_ring_as_missing_background():
    values = np.full((160, 160), 20.0)
    water = np.zeros((160, 160), bool)
    water[:, :40] = True
    _, share = analyzers.local_contrast(values, water, 61, 11)
    assert share[80, 5] > 0.9      # open sea
    assert share[80, 120] == 0     # inland, no water in the ring at all
    assert share[80, 60] < 0.5     # a shoreline is not somewhere a ship can be


# -- hotspots ----------------------------------------------------------------------------


def test_hotspot_sweep_separates_fire_from_a_cloud_that_is_just_as_bright(client, copernicus):
    body = sentinel_input("anomaly")
    ground = fire_frame()
    flame(ground, 150, 160, 3, 3)
    flame(ground, 300, 300, 40, 40, b12=0.5, ratio=1.0)   # cloud: bright, ratios at one
    seed(body, after=ground)
    saved = run(client, copernicus, body)
    assert saved["status"] == "ready", saved
    assert saved["count"] == 1, [r["area"] for r in saved["results"]]
    row = saved["results"][0]
    assert row["phenomenon"] == "Hotspot candidate"
    assert row["area"] < 2000
    assert row["measure"]["value"] == pytest.approx(2.5, abs=0.05)
    z, x, y = SENTINEL_TILE
    west, north = analyzers.geographic((x + 150 / 512) / 2**z, (y + 160 / 512) / 2**z)
    assert abs(row["coordinates"][0] - west) < 0.001
    assert abs(row["coordinates"][1] - north) < 0.001


def test_hotspot_sweep_ignores_short_wave_below_the_published_floor(client, copernicus):
    body = sentinel_input("anomaly")
    ground = fire_frame()
    flame(ground, 150, 160, 3, 3, b12=analyzers.HOTSPOT_FLOOR - 0.02)
    seed(body, after=ground)
    saved = run(client, copernicus, body)
    assert saved["status"] == "ready", saved
    assert saved["count"] == 0


def test_the_default_hotspot_ratio_is_the_published_one():
    recipe = next(r for r in BUILTINS if r.id == "anomaly")
    assert analyzers._scale(recipe.parameters.sensitivity, 1.0, 2.0) == pytest.approx(1.4)


# -- change between two dates -----------------------------------------------------------


def test_construction_is_ground_that_moved_the_same_way_in_every_band(client, copernicus):
    body = sentinel_input("structures")
    before, after = surface(0.20, 0.28, 0.32), surface(0.20, 0.28, 0.32)   # bare ground
    after[at(100, 100, 20, 20)] = code(0.33, 0.40, 0.45)        # new pad: brighter everywhere
    before[at(300, 300, 40, 40)] = code(0.05, 0.40, 0.18)       # a field that greened...
    after[at(300, 300, 40, 40)] = code(0.03, 0.60, 0.15)        # ...moved red and NIR apart
    seed(body, before, after)
    saved = run(client, copernicus, body)
    assert saved["status"] == "ready", saved
    assert saved["count"] == 1
    assert saved["results"][0]["measure"]["signed"] > 5


def test_small_spots_are_found_where_everything_around_them_held_still(client, copernicus):
    body = sentinel_input("impacts")
    before, after = surface(0.20, 0.30, 0.30), surface(0.20, 0.30, 0.30)
    after[at(100, 100, 2, 2)] = code(0.08, 0.12, 0.10)          # a burn mark two pixels wide
    after[at(300, 300, 120, 120)] = code(0.35, 0.40, 0.45)      # a whole field changed
    after[at(300, 300, 2, 2)] = code(0.05, 0.05, 0.05)          # a spot inside that field
    seed(body, before, after)
    saved = run(client, copernicus, body)
    assert saved["status"] == "ready", saved
    assert saved["count"] == 1, [r["coordinates"] for r in saved["results"]]
    row = saved["results"][0]
    assert row["measure"]["signed"] < 0
    assert row["area"] < 500


def test_a_granule_edge_is_not_a_spot(client, copernicus):
    """One date ends mid-tile, and that is not a change in the ground.

    The spot test measures a change against the change around it, so the ring
    it reads has to hold only pixels the sweep can measure. With nodata in it,
    a quiet tile cut by a granule edge produced a candidate the size of the cut.
    """
    before, after = surface(0.20, 0.30, 0.30), surface(0.20, 0.30, 0.30)
    after[:, 300:] = 0                                          # the granule stops here
    after[at(100, 100, 3, 3)] = code(0.05, 0.08, 0.08)           # a real mark beside it
    # Size All, so nothing is dropped for being too big to be a spot: the point
    # is that the seam raises no candidate at all, not that one is filtered out.
    body = sentinel_input("impacts", **SIZES["spots"]["all"])
    seed(body, before, after)
    saved = run(client, copernicus, body)
    assert saved["status"] == "ready", saved
    assert saved["count"] == 1, [(r["coordinates"], r["area"]) for r in saved["results"]]
    assert saved["results"][0]["area"] < 500


def test_a_cloud_edge_is_not_a_spot(client, copernicus):
    """A masked cloud is missing ground, exactly as nodata is."""
    before, after = surface(0.20, 0.30, 0.30), surface(0.20, 0.30, 0.30)
    after[:, 300:] = code(0.75, 0.80, 0.70, CLOUD)
    body = sentinel_input("impacts", **SIZES["spots"]["all"])
    seed(body, before, after)
    saved = run(client, copernicus, body)
    assert saved["status"] == "ready", saved
    assert saved["count"] == 0, [(r["coordinates"], r["area"]) for r in saved["results"]]


def test_a_mark_wider_than_its_window_still_reads_its_own_contrast(client, copernicus):
    """A median box the size of the target takes the target for its background.

    The background is read from a ring with a hole in it instead, so a 90 m mark
    in the desert measures what it really moved. Small then drops it for its
    size, with nothing to show for it — which is what All is for.
    """
    ground = surface(0.37, 0.40, 0.55)
    marked = surface(0.37, 0.40, 0.55)
    marked[at(200, 200, 10, 10)] = code(0.29, 0.30, 0.45)

    body = sentinel_input("impacts")
    seed(body, ground, marked)
    assert run(client, copernicus, body)["count"] == 0

    body = sentinel_input("impacts", **SIZES["spots"]["all"])
    seed(body, ground, marked)
    saved = run(client, copernicus, body)
    assert saved["status"] == "ready", saved
    assert saved["count"] == 1, [r["area"] for r in saved["results"]]
    row = saved["results"][0]
    assert row["area"] > 800                                   # too big for Small
    assert row["measure"]["signed"] < -5                       # and it moved 8-10%


def test_a_burn_has_to_end_dark_and_a_dried_pasture_does_not(client, copernicus):
    """Dry soil has a negative burn ratio too; char is what is dark."""
    body = sentinel_input("burn-scars")
    before, after = index_frame(0.5), index_frame(0.5)
    after[at(100, 100, 40, 40)] = [index_byte(-0.3), 0, 0, BARE + DARK]   # burned
    after[at(300, 300, 40, 40)] = [index_byte(-0.1), 0, 0, BARE]          # dried, still bright
    seed(body, before, after)
    saved = run(client, copernicus, body)
    assert saved["status"] == "ready", saved
    assert saved["count"] == 1
    row = saved["results"][0]
    assert row["measure"]["before"] == pytest.approx(0.5, abs=0.02)
    assert row["measure"]["after"] == pytest.approx(-0.3, abs=0.02)


def test_an_index_loss_has_to_start_from_something_there(client, copernicus):
    """NDVI noise over bare ground is not vegetation loss."""
    body = sentinel_input("vegetation-loss")
    before, after = index_frame(0.1), index_frame(0.1)
    before[at(100, 100, 40, 40)] = [index_byte(0.7), 0, 0, VEGETATION]
    after[at(100, 100, 40, 40)] = [index_byte(0.2), 0, 0, BARE]            # cleared
    before[at(300, 300, 40, 40)] = [index_byte(0.35), 0, 0, BARE]          # never green
    after[at(300, 300, 40, 40)] = [index_byte(-0.1), 0, 0, BARE]
    before[at(100, 300, 40, 40)] = [index_byte(0.8), 0, 0, VEGETATION]     # still green
    after[at(100, 300, 40, 40)] = [index_byte(0.45), 0, 0, VEGETATION]
    seed(body, before, after)
    saved = run(client, copernicus, body)
    assert saved["status"] == "ready", saved
    assert saved["count"] == 1


def test_a_whole_tile_that_burned_is_not_taken_for_a_change_in_light(client, copernicus):
    """The overall shift between passes is taken out, but only up to 3%: a burn
    that covers most of the tile moves the median itself."""
    body = sentinel_input("large-change", min_area=0, max_area=0)
    before = surface(0.10, 0.30, 0.25)
    after = surface(0.06, 0.12, 0.12)
    after[at(0, 0, 100, 512)] = code(0.10, 0.30, 0.25)
    seed(body, before, after)
    saved = run(client, copernicus, body)
    assert saved["status"] == "ready", saved
    assert saved["count"] >= 1
    assert max(row["area"] for row in saved["results"]) > 1_000_000


def test_candidates_come_strongest_first(client, copernicus):
    body = sentinel_input("large-change", min_area=0, max_area=0, cleanup=0, merge_metres=0)
    before, after = surface(), surface()
    after[at(50, 50, 20, 20)] = code(0.19, 0.39, 0.29)    # a modest change
    after[at(300, 300, 20, 20)] = code(0.40, 0.45, 0.50)  # a large one
    seed(body, before, after)
    saved = run(client, copernicus, body)
    margins = [row["margin"] for row in saved["results"]]
    assert len(margins) == 2 and margins == sorted(margins, reverse=True)
    assert saved["results"][0]["strength"] == "strong"


def test_direction_keeps_only_the_way_that_was_asked_for(client, copernicus):
    body = sentinel_input("large-change", min_area=0, max_area=0, direction="loss")
    before, after = surface(), surface()
    after[at(50, 50, 20, 20)] = code(0.40, 0.50, 0.50)    # brighter
    after[at(300, 300, 20, 20)] = code(0.02, 0.05, 0.02)  # darker
    seed(body, before, after)
    saved = run(client, copernicus, body)
    assert saved["count"] == 1
    assert saved["results"][0]["coordinates"][0] > body["zones"][0]["points"][0][0]


# -- sky ----------------------------------------------------------------------------------


def _sky_body(**parameters):
    return RunInput.model_validate(sentinel_input("large-change", **parameters))


def test_a_cloud_takes_its_unsure_edge_but_a_small_bright_tag_is_not_cloud():
    frame = surface()
    frame[at(100, 100, 20, 20)][:, :, 3] = CLOUD                 # 1.8 ha: a white roof
    frame[at(250, 250, 120, 120)][:, :, 3] = CLOUD               # a real cloud
    frame[at(240, 250, 10, 120)][:, :, 3] = UNSURE               # its thin western edge
    frame[at(20, 20, 10, 10)][:, :, 3] = UNSURE                  # an unsure pixel on its own
    metres = 6.7
    cloud, _ = analyzers.sky(frame, "2026-05-11", 45.5, metres)
    core = cloud[PAD:-PAD, PAD:-PAD]
    assert not core[100:120, 100:120].any()
    assert core[250:370, 250:370].all()
    assert core[250:370, 240:250].all()
    assert not core[20:30, 20:30].any()


def test_a_shadow_the_classification_missed_is_found_away_from_the_sun():
    """In May at 45°N the satellite sees the sun in the south-east, so a cloud's
    shadow falls to its north-west, on ground dark enough to be shaded."""
    frame = surface()
    frame[at(300, 300, 80, 80)][:, :, 3] = CLOUD
    shaded = frame[at(200, 180, 90, 90)]
    shaded[:, :, 3] = VEGETATION + DARK                          # north-west: shadow
    darkness = frame[at(420, 420, 60, 60)]
    darkness[:, :, 3] = VEGETATION + DARK                        # south-east: just dark ground
    _, shadow = analyzers.sky(frame, "2026-05-11", 45.5, 6.7)
    core = shadow[PAD:-PAD, PAD:-PAD]
    assert core[200:270, 200:270].any()
    assert not core[420:480, 420:480].any()


def test_a_shadow_the_classification_called_water_is_still_a_shadow():
    """Sen2Cor reads a deep cloud shadow as water, and a cast that spares water
    then finds none of it. A second pass settles it: water is water when both
    dates say so, and a shadow is what only one of them calls water."""
    frame = surface()
    frame[at(300, 300, 80, 80)][:, :, 3] = CLOUD
    frame[at(200, 180, 45, 90)][:, :, 3] = WATER + DARK          # shadow, read as water
    frame[at(245, 180, 45, 90)][:, :, 3] = WATER + DARK          # a real lake
    clear = surface()
    clear[at(245, 180, 45, 90)][:, :, 3] = WATER                 # the lake, on the other date
    _, alone = analyzers.sky(frame, "2026-05-11", 45.5, 6.7)
    _, paired = analyzers.sky(frame, "2026-05-11", 45.5, 6.7, clear)
    assert not alone[PAD:-PAD, PAD:-PAD][200:270, 200:245].any()
    assert paired[PAD:-PAD, PAD:-PAD][200:270, 200:245].any()
    assert not paired[PAD:-PAD, PAD:-PAD][200:270, 245:290].any()


def test_the_sun_is_where_the_satellite_saw_it():
    """Checked against the angle bands of real scenes, to within a few degrees."""
    for day, lat, azimuth, zenith in [("2026-09-08", 12.6, 108.2, 20.4),
                                      ("2026-08-12", 1.24, 57.6, 26.5),
                                      ("2026-09-13", 39.24, 157.6, 37.8),
                                      ("2026-09-12", -9.79, 61.0, 27.5)]:
        found_azimuth, found_zenith = analyzers.sun_position(day, lat)
        assert abs(found_azimuth - azimuth) < 6
        assert abs(found_zenith - zenith) < 3


def test_the_cloud_margin_grows_the_mask_past_the_classified_edge():
    body = _sky_body(cloud_margin=3)
    frame = surface()
    frame[at(200, 200, 100, 100)][:, :, 3] = CLOUD
    blocked = analyzers.weather_mask([frame, frame], ["2026-05-04", "2026-05-11"], 45.5, 6.7,
                                     body.recipe.parameters)
    core = blocked[PAD:-PAD, PAD:-PAD]
    assert core[197:303, 197:303].all()
    assert not core[190:196, 190:196].any()


def test_turning_both_switches_off_masks_nothing():
    body = _sky_body(ignore_clouds=False, ignore_shadows=False)
    frame = surface()
    frame[:, :, 3] = CLOUD
    assert analyzers.weather_mask([frame], ["2026-05-11"], 45.5, 6.7,
                                  body.recipe.parameters) is None


def test_a_change_under_cloud_on_either_date_is_not_a_change(client, copernicus):
    body = sentinel_input("large-change", min_area=0, max_area=0, cleanup=0)
    before, after = surface(), surface()
    after[at(200, 200, 120, 120)] = code(0.45, 0.50, 0.45, sky=CLOUD)
    seed(body, before, after)
    assert run(client, copernicus, body)["count"] == 0


# -- follow-ups and date rules -------------------------------------------------------------


def test_named_followup_freezes_input_and_previous_date(client, scenario, monkeypatch):
    case, body = scenario
    follow = client.post(f"/api/cases/{case.id}/analysis/followups", json=body).json()
    body["followup_id"] = follow["id"]
    previous = run(client, case, body)
    client.put("/api/settings/keys", json={"sentinelhub": "inst-uuid"})
    monkeypatch.setattr(analyzers.sentinel, "acquisitions", lambda *a, **k: {"dates": [
        {"date": "2026-05-18", "cloud": 5.0, "granules": 1, "coverage": 1.0},
    ], "truncated": False})
    newer = {**body, "offline": False, "date_rule": "latest_previous"}
    resolved = analyzers.resolve_dates(case, RunInput.model_validate(newer))
    assert resolved.a.date == previous["input"]["b"]["date"] and resolved.b.date == "2026-05-18"
    changed = deepcopy(body)
    changed["zones"][0]["name"] = "New name"
    assert client.put(f"/api/cases/{case.id}/analysis/followups/{follow['id']}", json=changed).status_code == 200
    assert analyzers.read(case, "runs", previous["id"])["input"]["zones"][0]["name"] == "Patch"


def _rule(body, rule="latest_reference"):
    return {**deepcopy(body), "offline": False, "date_rule": rule}


def test_an_automatic_date_rule_takes_the_newest_pass_that_covers_the_whole_area(
    client, scenario, monkeypatch
):
    """The old rule asked about each area's *centre*, which a swath can reach
    while missing most of the shape around it. Picking that date sweeps nodata."""
    case, body = scenario
    client.put("/api/settings/keys", json={"sentinelhub": "inst-uuid"})
    asked = {}

    def acquisitions(instance, rings, start, end):
        asked.update(instance=instance, rings=rings, start=start, end=end)
        return {"dates": [
            {"date": "2026-05-20", "cloud": 5.0, "granules": 1, "coverage": 0.61},
            {"date": "2026-05-11", "cloud": 5.0, "granules": 2, "coverage": 1.0},
            {"date": "2026-05-04", "cloud": 5.0, "granules": 1, "coverage": 1.0},
        ], "truncated": False}

    monkeypatch.setattr(analyzers.sentinel, "acquisitions", acquisitions)
    resolved = analyzers.resolve_dates(case, RunInput.model_validate(_rule(body)))
    # the newest is 2026-05-20 and it reaches 61% of the area, so it is not it
    assert resolved.b.date == "2026-05-11"
    # one lookup for the whole set, not one per area
    assert len(asked["rings"]) == 1


def test_an_automatic_date_rule_says_how_far_the_best_pass_reached(
    client, scenario, monkeypatch
):
    case, body = scenario
    client.put("/api/settings/keys", json={"sentinelhub": "inst-uuid"})
    monkeypatch.setattr(analyzers.sentinel, "acquisitions", lambda *a, **k: {"dates": [
        {"date": "2026-05-20", "cloud": 5.0, "granules": 1, "coverage": 0.61},
    ], "truncated": False})
    with pytest.raises(ValueError) as raised:
        analyzers.resolve_dates(case, RunInput.model_validate(_rule(body)))
    # naming the number turns "it failed" into "pick the dates by hand"
    assert "61%" in str(raised.value)


def test_an_automatic_date_rule_still_honours_the_cloud_ceiling(client, scenario, monkeypatch):
    case, body = scenario
    client.put("/api/settings/keys", json={"sentinelhub": "inst-uuid"})
    monkeypatch.setattr(analyzers.sentinel, "acquisitions", lambda *a, **k: {"dates": [
        {"date": "2026-05-20", "cloud": 80.0, "granules": 1, "coverage": 1.0},
        {"date": "2026-05-11", "cloud": 5.0, "granules": 1, "coverage": 1.0},
    ], "truncated": False})
    resolved = analyzers.resolve_dates(case, RunInput.model_validate(_rule(body)))
    assert resolved.b.date == "2026-05-11"


def test_band_products_are_padded_and_keyed_apart_from_older_layouts():
    body = RunInput.model_validate(sample_input())
    z, x, y = SENTINEL_TILE
    picture = analyzers._key(body.b, z, x, y, None)
    product = analyzers._key(body.b, z, x, y, "surface")
    assert picture != product
    assert analyzers.product_cache_id(body.b, "surface").endswith(f"~surface~v{analyzers.PRODUCT_VERSION}")
    assert EDGE == 512 + 2 * analyzers.PAD
    assert WATER == analyzers.SCL_WATER
