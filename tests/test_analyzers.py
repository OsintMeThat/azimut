"""Local analyzer behavior, bounds, provenance and persistence boundaries."""

import io
from copy import deepcopy

import numpy as np
import pytest
from PIL import Image

from azimut import config, layout
from azimut.engine import analysis_models as analyzers_models
from azimut.engine import analyzers, tilecache, workqueue
from azimut.engine.analysis_models import METHODS, Recipe, RunInput, Zone
from azimut.workspace import Case
from analyzerfixture import (
    SENTINEL_TILE,
    fire_bands,
    sample_input,
    seed_images,
    seed_sentinel,
    sentinel_input,
    vessel_bands,
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
    monkeypatch.setattr(analyzers.wayback, "releases", forbidden)
    return case, body


def run(client, case, body):
    result = client.post(f"/api/cases/{case.id}/analysis/runs", json=body)
    assert result.status_code == 200, result.text
    workqueue.drain(case)
    return client.get(f"/api/cases/{case.id}/analysis/runs/{result.json()['id']}").json()


def test_local_run_keeps_frames_and_review_without_network(client, scenario):
    case, body = scenario
    saved = run(client, case, body)
    assert saved["status"] == "ready", saved
    assert saved["count"] == 1
    assert len(saved["frames"]) == 2
    row = saved["results"][0]
    assert row["confidence"] is None
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
    assert not case.resolve_inside(layout.analysis_assets_rel(f"runs-{saved['id']}" )).exists()


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
    """Legibility comes from whole-number nearest-neighbour zoom, not smoothing.

    A candidate can be a dozen pixels across. Served at that size the browser
    stretches it into a blur, so the server does the enlarging itself, by an
    integer factor and with no interpolation: bigger, and still the pixels the
    sensor recorded.
    """
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


def test_reading_saved_items_never_starts_jobs(client, scenario):
    case, body = scenario
    before = case.list_jobs()
    assert client.get("/api/compare/analyzers").status_code == 200
    for kind in ("zones", "followups", "runs"):
        assert client.get(f"/api/cases/{case.id}/analysis/{kind}").json() == []
    assert case.list_jobs() == before
    zone = client.post(f"/api/cases/{case.id}/analysis/zones", json={"title": "Port", "zones": body["zones"]}).json()
    follow = client.post(f"/api/cases/{case.id}/analysis/followups", json=body).json()
    for kind, saved in (("zones", zone), ("followups", follow)):
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
    body["b"]["release"] = 3
    saved = run(client, case, body)
    assert saved["status"] == "failed"
    assert "offline" in saved["message"]
    assert saved["results"] == []


def test_tile_ceiling_and_provider_validation_before_job_creation(client, scenario):
    case, body = scenario
    # The panel prices an area against this number, so it has to be published.
    assert client.get("/api/compare/analyzers").json()["max_tiles"] == analyzers.MAX_TILES
    body["zones"][0]["points"] = [[0, 0], [1, 1]]
    response = client.post(f"/api/cases/{case.id}/analysis/runs", json=body)
    assert response.status_code == 422
    assert "smaller" in response.text
    assert case.list_jobs() == []
    body["b"]["provider"] = "google"
    assert client.post(f"/api/cases/{case.id}/analysis/runs", json=body).status_code == 422


def test_zone_union_does_not_duplicate_detections(client, scenario):
    case, body = scenario
    first = run(client, case, body)
    body["zones"].append({**body["zones"][0], "id": "overlap"})
    second = run(client, case, body)
    assert second["results"] == first["results"]
    assert second["total"] == first["total"]


def test_masks_filters_and_methods():
    body = RunInput.model_validate(sample_input())
    a = np.full((64, 64, 4), 30, np.uint8)
    a[:, :, 3] = 255
    b = a.copy()
    b[10:20, 10:20, :3] = 240
    b[40, 40, :3] = 240
    mask = np.ones((64, 64), np.uint8)
    for method in ("colour", "structure", "brightness", "water_objects", "smoke"):
        body.recipe.method = method
        binary, _ = analyzers.detect(a, b, mask, body)
        assert binary[8:22, 8:22].any(), method
    body.recipe.method = "colour"
    body.recipe.parameters.cleanup = 1
    binary, _ = analyzers.detect(a, b, mask, body)
    assert binary[15, 15] and not binary[40, 40]
    mask[:30] = 0
    binary, _ = analyzers.detect(a, b, mask, body)
    assert not binary[:30].any()


def _spectral_pair():
    a = np.zeros((16, 16, 4), np.uint8)
    a[:, :, 3] = 255
    a[:, :, 1] = 4
    b = a.copy()
    b[:, :, 0] = 200
    b[:8, :, 1] = 9  # the top half is cloud, by Sentinel-2's own classification
    return a, b


def test_spectral_cloud_mask_and_native_grid():
    body = sample_input()
    body["a"] = {"provider": "sentinel2", "date": "2026-08-01"}
    body["b"] = {"provider": "sentinel2", "date": "2026-09-01"}
    body["recipe"].update(method="index", providers=["sentinel2"])
    body["recipe"]["parameters"]["cloud_margin"] = 0
    model = RunInput.model_validate(body)
    assert analyzers.grid(model) == (13, 512)
    a, b = _spectral_pair()
    mask = np.ones((16, 16), np.uint8)
    binary, _ = analyzers.detect(a, b, mask, model, a, b)
    assert not binary[:8].any()
    assert binary[8:].all()


def test_the_cloud_margin_grows_the_mask_past_the_classified_edge():
    """A classification calls the cloud's soft edge ground, and that edge is
    where the ring of false candidates around every mask comes from. The margin
    is what takes it, so it has to cost exactly the pixels it claims."""
    body = sample_input()
    body["a"] = {"provider": "sentinel2", "date": "2026-08-01"}
    body["b"] = {"provider": "sentinel2", "date": "2026-09-01"}
    body["recipe"].update(method="index", providers=["sentinel2"])
    body["recipe"]["parameters"]["cloud_margin"] = 2
    model = RunInput.model_validate(body)
    a, b = _spectral_pair()
    binary, _ = analyzers.detect(a, b, np.ones((16, 16), np.uint8), model, a, b)
    assert not binary[:10].any()
    assert binary[10:].all()


def test_named_followup_freezes_input_and_previous_date(client, scenario, monkeypatch):
    case, body = scenario
    follow = client.post(f"/api/cases/{case.id}/analysis/followups", json=body).json()
    body["followup_id"] = follow["id"]
    previous = run(client, case, body)
    newer = {**body, "offline": False, "date_rule": "latest_previous"}
    monkeypatch.setattr(analyzers.wayback, "releases", lambda: [type("Release", (), {"number": 3})()])
    resolved = analyzers.resolve_dates(case, RunInput.model_validate(newer))
    assert resolved.a.release == 2 and resolved.b.release == 3
    changed = deepcopy(body)
    changed["zones"][0]["name"] = "New name"
    assert client.put(f"/api/cases/{case.id}/analysis/followups/{follow['id']}", json=changed).status_code == 200
    assert analyzers.read(case, "runs", previous["id"])["input"]["zones"][0]["name"] == "Harbour"


def _picture_pair():
    """A flat grey tile, and the same with a bright colourless patch added.

    Which is the whole difficulty: on a rendered picture that patch is equally
    a cloud, a white roof and a gravel pad, and nothing in the image says which.
    """
    a = np.zeros((32, 32, 4), np.uint8)
    a[:, :, :3] = 60
    a[:, :, 3] = 255
    b = a.copy()
    b[10:20, 10:20, :3] = 235
    return a, b


def test_the_picture_cloud_guess_is_off_until_it_is_asked_for():
    """It cannot tell cloud from a white roof, so it is never turned on for
    anyone: a saved recipe must keep finding what it found yesterday."""
    body = sample_input()
    assert Recipe.model_validate(body["recipe"]).parameters.guess_clouds is False
    model = RunInput.model_validate(body)
    a, b = _picture_pair()
    binary, _ = analyzers.detect(a, b, np.ones((32, 32), np.uint8), model)
    assert binary[10:20, 10:20].any()


def test_the_picture_cloud_guess_masks_bright_colourless_pixels_when_asked():
    body = sample_input()
    body["recipe"]["parameters"].update(guess_clouds=True, cloud_margin=0)
    model = RunInput.model_validate(body)
    a, b = _picture_pair()
    binary, _ = analyzers.detect(a, b, np.ones((32, 32), np.uint8), model)
    assert not binary.any()


def test_no_cloud_filter_is_offered_where_it_would_eat_the_signal():
    """Smoke, bright shapes on water and a short-wave hotspot are bright and
    colourless themselves. There the picture test would mask the method's own
    subject, so the catalogue offers nothing rather than a switch that ruins it."""
    offered = {entry["id"]: entry["cloud_filter"] for entry in METHODS}
    assert offered["smoke"] == "" and offered["water_objects"] == ""
    assert offered["hotspots"] == ""  # its band ratios reject cloud already
    assert offered["index"] == "classes" and offered["vessels"] == "classes"
    assert offered["colour"] == "picture"

    body = sample_input()
    body["recipe"].update(method="smoke")
    body["recipe"]["parameters"].update(guess_clouds=True, cloud_margin=0, sensitivity=90)
    model = RunInput.model_validate(body)
    a, b = _picture_pair()
    binary, _ = analyzers.detect(a, b, np.ones((32, 32), np.uint8), model)
    # the switch is set and the method ignores it, because it has to
    assert binary[10:20, 10:20].any()


def _sentinel_rule(body, rule="latest_reference"):
    sentinel_body = deepcopy(body)
    sentinel_body["recipe"]["providers"] = ["sentinel2"]
    sentinel_body["a"] = {"provider": "sentinel2", "date": "2026-04-01", "maxcc": 30}
    sentinel_body["b"] = {"provider": "sentinel2", "date": "2026-04-01", "maxcc": 30}
    return {**sentinel_body, "offline": False, "date_rule": rule}


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
    resolved = analyzers.resolve_dates(case, RunInput.model_validate(_sentinel_rule(body)))
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
        analyzers.resolve_dates(case, RunInput.model_validate(_sentinel_rule(body)))
    # naming the number turns "it failed" into "pick the dates by hand"
    assert "61%" in str(raised.value)


def test_an_automatic_date_rule_still_honours_the_cloud_ceiling(client, scenario, monkeypatch):
    case, body = scenario
    client.put("/api/settings/keys", json={"sentinelhub": "inst-uuid"})
    monkeypatch.setattr(analyzers.sentinel, "acquisitions", lambda *a, **k: {"dates": [
        {"date": "2026-05-20", "cloud": 80.0, "granules": 1, "coverage": 1.0},
        {"date": "2026-05-11", "cloud": 5.0, "granules": 1, "coverage": 1.0},
    ], "truncated": False})
    resolved = analyzers.resolve_dates(case, RunInput.model_validate(_sentinel_rule(body)))
    assert resolved.b.date == "2026-05-11"


def test_a_run_reports_the_share_of_its_areas_that_had_imagery(client, scenario):
    """"Nothing found" and "never looked" are not the same answer, and a date
    whose granules only half reach the area produces the second while reading
    like the first."""
    case, body = scenario
    saved = run(client, case, body)
    assert saved["status"] == "ready"
    # the fixture's frames are fully opaque, so the sweep saw all of it
    assert saved["swept"] == 1.0


@pytest.mark.parametrize("points", [[[0, 0], [0, 1]], [[179, 0], [-179, 1]], [[0, 86], [1, 87]]])
def test_invalid_areas_are_rejected(points):
    with pytest.raises(ValueError):
        Zone(id="zone", points=points)


def test_models_cannot_smuggle_executable_recipes():
    with pytest.raises(ValueError):
        Recipe(name="Bad", method="python", code="anything")
    assert config.DEFAULT_SETTINGS["analyzers"] == []


def test_local_contrast_reads_a_target_against_its_own_patch_of_sea():
    """The same hull, on calm water and on water twice as bright, reads the same.

    That is the whole reason the detector is local: an absolute cut-off would
    need a different number for every scene, and would call a sunlit swell a
    fleet.
    """
    rng = np.random.default_rng(7)
    calm = np.full((200, 200), 20.0) + rng.normal(0, 1.5, (200, 200))
    water = np.ones((200, 200), bool)
    readings = []
    for sea in (calm, calm + 120):
        empty, share = analyzers.local_contrast(sea, water, 61, 11)
        assert share.min() > 0.99
        assert abs(empty[100, 100]) < 4
        target = sea.copy()
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


@pytest.fixture
def sea(client, monkeypatch):
    monkeypatch.setattr(workqueue, "start_workers", False)
    ident = client.post("/api/cases", json={"name": "Copernicus detectors"}).json()["id"]
    case = Case.open(ident)
    def forbidden(*args, **kwargs):
        raise AssertionError("unexpected network")
    monkeypatch.setattr(analyzers.httpx, "stream", forbidden)
    monkeypatch.setattr(analyzers.sentinel, "band_frame", forbidden)
    return case


def test_vessel_sweep_finds_the_targets_and_not_the_bright_water(client, sea):
    body = sentinel_input("boats")
    seed_sentinel(sea, body, vessel_bands([(120, 140, 3, 3), (300, 220, 4, 2)]))
    saved = run(client, sea, body)
    assert saved["status"] == "ready", saved
    assert saved["count"] == 2, [r["coordinates"] for r in saved["results"]]
    assert {r["phenomenon"] for r in saved["results"]} == {"Vessel candidate"}
    for row in saved["results"]:
        # Nine pixels of 9.55 m is a little over 800 m²; two of them, 180 m².
        assert 150 < row["area"] < 1000
        assert row["signal_score"] > 0.2
        # A signal score is not a probability, and nothing here pretends it is.
        assert row["confidence"] is None
    assert len(saved["frames"]) == 2   # the picture reviewed, and the bands measured


def test_vessel_sweep_asks_for_one_date_and_never_for_a_reference(client, sea):
    body = sentinel_input("boats")
    seed_sentinel(sea, body, vessel_bands([(200, 200, 3, 3)]))
    body["a"] = {"provider": "sentinel2", "date": "", "layer": "TRUE_COLOR", "maxcc": 30}
    saved = run(client, sea, body)
    assert saved["status"] == "ready", saved
    assert saved["input"]["a"] == saved["input"]["b"]
    assert saved["count"] == 1


def test_hotspot_sweep_separates_fire_from_a_cloud_that_is_just_as_bright(client, sea):
    body = sentinel_input("anomaly")
    seed_sentinel(sea, body, fire_bands(fire=(150, 160, 3, 3), cloud=(300, 300, 40, 40)))
    saved = run(client, sea, body)
    assert saved["status"] == "ready", saved
    assert saved["count"] == 1, [r["area"] for r in saved["results"]]
    row = saved["results"][0]
    assert row["phenomenon"] == "Hotspot candidate"
    # The fire patch, not the cloud forty times its size.
    assert row["area"] < 2000
    z, x, y = SENTINEL_TILE
    west, north = analyzers.geographic((x + 150 / 512) / 2**z, (y + 160 / 512) / 2**z)
    assert abs(row["coordinates"][0] - west) < 0.001
    assert abs(row["coordinates"][1] - north) < 0.001


def test_hotspot_sweep_ignores_short_wave_below_the_published_floor(client, sea):
    body = sentinel_input("anomaly")
    bands = fire_bands(fire=(150, 160, 3, 3), cloud=(300, 300, 40, 40))
    # Right ratios, not enough energy: warm ground is not a fire.
    bands[160:163, 150:153, 0] = int(255 * (analyzers.HOTSPOT_FLOOR - 0.02) * 4)
    seed_sentinel(sea, body, bands)
    saved = run(client, sea, body)
    assert saved["status"] == "ready", saved
    assert saved["count"] == 0


@pytest.mark.parametrize("recipe_id", ["boats", "anomaly"])
def test_band_detectors_refuse_a_provider_that_serves_pictures(recipe_id):
    recipe = next(r for r in analyzers_models.BUILTINS if r.id == recipe_id)
    assert recipe.providers == ["sentinel2"]
    with pytest.raises(ValueError):
        recipe.model_copy(update={"providers": ["esri-wayback", "sentinel2"]}).compatible()


def seed_tile(x, y, changed):
    """One Wayback tile pair, with the change only where a test asks for it."""
    for release in (1, 2):
        pixels = np.full((256, 256, 3), 40, np.uint8)
        if release == 2 and changed:
            pixels[90:120, 100:150] = 230
        out = io.BytesIO()
        Image.fromarray(pixels).save(out, "PNG")
        tilecache.put(f"esri-wayback~{release}", 19, x, y, out.getvalue(), "image/png")


def test_a_sweep_keeps_only_the_tiles_that_found_something(client, scenario):
    """What a case stores follows what was found, not how much was swept.

    This is what lets the allowed area be large: two tiles are read, one shows
    nothing, and only the tile behind the candidate keeps a permanent copy.
    """
    case, body = scenario
    z, x, y = 19, 265056, 182248
    west, north = analyzers.geographic((x + .1) / 2**z, (y + .1) / 2**z)
    east, south = analyzers.geographic((x + 1.9) / 2**z, (y + .9) / 2**z)
    body["zones"][0]["points"] = [[west, south], [east, north]]
    seed_tile(x, y, changed=True)
    seed_tile(x + 1, y, changed=False)

    saved = run(client, case, body)
    assert saved["status"] == "ready", saved
    assert saved["total"] == 2
    assert saved["count"] == 1
    assert len(saved["frames"]) == 2
    assert {tuple(record["tile"]) for record in saved["frames"].values()} == {(z, x, y)}
    folder = case.resolve_inside(layout.analysis_assets_rel(f"runs-{saved['id']}"))
    assert {path.name for path in folder.iterdir()} == {
        record["path"].rsplit("/", 1)[1] for record in saved["frames"].values()
    }
    # Whatever a candidate points at still resolves, which is the invariant
    # the preview and the bundle both rely on.
    for row in saved["results"]:
        for part in row["parts"]:
            for key in part["frames"]:
                assert case.resolve_inside(saved["frames"][key]["path"]).is_file()
    endpoint = f"/api/cases/{case.id}/analysis/runs/{saved['id']}/results/{saved['results'][0]['id']}"
    assert client.get(endpoint + "/preview").content.startswith(b"\x89PNG")
