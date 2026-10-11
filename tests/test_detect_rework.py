"""Detect orchestration, shared areas, review and snapshot boundaries."""

import io
import json
from copy import deepcopy

import numpy as np
import pytest
from PIL import Image

from azimut import config, layout
from azimut.engine import analysis_geometry, analyzers, bundles, maplayers, media, workqueue
from azimut.engine.analysis_models import RunInput, Zone
from azimut.workspace import Case
from analyzerfixture import (
    SENTINEL_TILE,
    analyzer_case,
    fire_frame,
    flame,
    hull,
    run,
    sea,
    seed,
    seed_images,
    sentinel_input,
    zone,
)


@pytest.fixture
def scenario(client, monkeypatch):
    return analyzer_case(client, monkeypatch)


def area_body(raw):
    parsed = Zone.model_validate(raw)
    ring = parsed.ring()
    return {"name": parsed.name, "colour": "#123456", "geometry": {"type": "Polygon", "coordinates": [ring + [ring[0]]]}}


def test_shared_area_is_reusable_and_delete_names_its_routines(client, scenario):
    case, body = scenario
    base = f"/api/cases/{case.id}/analysis"
    area = client.post(base + "/areas", json=area_body(body["zones"][0])).json()
    shared = {**body, "zones": [], "area_dates": [{"area_id": area["id"], "a": body["a"], "b": body["b"], "date_rule": "manual"}]}
    watches = [client.post(base + "/followups", json={**shared, "title": title}).json() for title in ("Port weekly", "Port baseline")]
    assert len(client.get(base + "/areas").json()) == 1
    for watch in watches:
        stored = json.loads(case.resolve_inside(analyzers.relpath("followups", watch["id"])).read_text())
        assert "zones" not in stored
        assert stored["area_dates"][0]["area_id"] == area["id"]
    saved = run(client, case, shared)
    assert saved["status"] == "ready"
    assert saved["results"][0]["area_id"] == area["id"]
    refused = client.delete(base + "/areas/" + area["id"])
    assert refused.status_code == 409
    assert "Port weekly" in refused.text and "Port baseline" in refused.text
    entity = case.find_entity(attr="spec", value=analyzers.relpath("areas", area["id"]))
    refused = client.delete(f"/api/cases/{case.id}/entities/{entity['id']}")
    assert refused.status_code == 409 and "Port weekly" in refused.text
    changed = {**area_body(body["zones"][0]), "name": "Renamed", "colour": "#abcdef"}
    assert client.put(base + "/areas/" + area["id"], json=changed).status_code == 200
    assert client.get(base + "/followups/" + watches[0]["id"]).json()["zones"][0]["name"] == "Renamed"
    assert analyzers.read(case, "runs", saved["id"])["input"]["zones"][0]["name"] == "Patch"
    for watch in watches:
        assert client.delete(base + "/followups/" + watch["id"]).status_code == 200
    removed = client.delete(base + "/areas/" + area["id"]).json()
    assert not case.resolve_inside(analyzers.relpath("areas", area["id"])).exists()
    assert client.post(f"/api/cases/{case.id}/trash/{removed['trash']}/restore").status_code == 200
    assert client.get(base + "/areas/" + area["id"]).json()["name"] == "Renamed"


def test_embedded_routine_migration_is_lossless_and_idempotent(client, scenario):
    case, body = scenario
    saved = analyzers.save(case, "followups", body)
    # Simulate an older record, including a zone carried by its recipe.
    old = {**saved, "zones": body["zones"], "recipe": {**body["recipe"], "zones": body["zones"]}}
    old.pop("area_dates")
    media.write_json_atomic(case.resolve_inside(analyzers.relpath("followups", saved["id"])), old)
    first = analyzers.read(case, "followups", saved["id"])
    second = analyzers.read(case, "followups", saved["id"])
    assert first == second
    assert first["created_at"] == old["created_at"]
    assert first["a"] == body["a"] and first["b"] == body["b"]
    assert Zone.model_validate(first["zones"][0]).ring() == Zone.model_validate(body["zones"][0]).ring()
    assert len(analyzers.listing(case, "areas")) == 1


def tracks(body):
    z, x, y = SENTINEL_TILE
    other = (z, x + 40, y + 30)
    body = deepcopy(body)
    body["zones"].append({**zone(tile=other, ident="other"), "name": "Other track"})
    body["offline"] = False
    body["area_dates"] = [{"area_id": area["id"], "a": body["a"], "b": {**body["b"], "date": ""},
                            "date_rule": "latest_reference"} for area in body["zones"]]
    return body, other


@pytest.mark.parametrize("partial", [False, True])
def test_each_track_resolves_its_own_pass_and_only_the_missing_area_fails(client, scenario, monkeypatch, partial):
    case, body = scenario
    body, other = tracks(body)
    seed_images({**body, "b": {**body["b"], "date": "2026-05-13"}}, other)
    client.put("/api/settings/keys", json={"sentinelhub": "test-instance"})
    calls = []
    first_lon = body["zones"][0]["points"][0][0]
    def lookup(instance, rings, start, end, collection="sentinel2", on_request=None):
        calls.append(rings)
        on_request()  # one catalogue page, on the meter
        assert len(rings) == 1
        first = rings[0][0][0] == first_lon
        return {"dates": [] if partial and not first else [{"date": "2026-05-11" if first else "2026-05-13",
            "cloud": 5, "coverage": 1}]}
    monkeypatch.setattr(analyzers.sentinel, "acquisitions", lookup)
    saved = run(client, case, body)
    assert saved["status"] == "ready", saved
    assert len(calls) == 2
    assert config.month_usage("sentinelhub") == 2
    if partial:
        assert "Other track" in saved["message"]
        assert {r["area_id"] for r in saved["results"]} == {"patch"}
        assert saved["area_runs"][1]["status"] == "failed"
    else:
        assert [p["b"]["date"] for p in saved["area_runs"]] == ["2026-05-11", "2026-05-13"]
        assert {r["area_id"] for r in saved["results"]} == {"patch", "other"}


def test_previous_pass_is_per_area_and_explicit_launch_never_looks_up(client, scenario):
    case, body = scenario
    body, other = tracks(body)
    body["offline"] = True
    for i, pair in enumerate(body["area_dates"]):
        pair["date_rule"] = "manual"
        pair["b"]["date"] = "2026-05-11" if i == 0 else "2026-05-13"
    seed_images({**body, "b": body["area_dates"][1]["b"]}, other)
    base = f"/api/cases/{case.id}/analysis"
    watch = client.post(base + "/followups", json=body).json()
    started = client.post(base + f"/followups/{watch['id']}/run").json()
    workqueue.drain(case)
    initial = analyzers.read(case, "runs", started["id"])
    pairs = []
    for i, pair in enumerate(initial["area_runs"]):
        nxt = {**pair["b"], "date": "2026-05-20"}
        seed_images({**body, "a": pair["b"], "b": nxt}, SENTINEL_TILE if i == 0 else other)
        pairs.append({"area_id": pair["area_id"], "a": body["a"], "b": nxt, "date_rule": "latest_previous"})
    started = client.post(base + f"/followups/{watch['id']}/run", json={"area_dates": pairs}).json()
    workqueue.drain(case)
    second = analyzers.read(case, "runs", started["id"])
    assert second["status"] == "ready", second
    assert [p["a"]["date"] for p in second["area_runs"]] == ["2026-05-11", "2026-05-13"]


def test_keep_all_keeps_only_new_candidates_in_the_open_run_and_allows_dismiss(client, scenario):
    case, body = scenario
    saved = run(client, case, body)
    saved["results"] += [{**deepcopy(saved["results"][0]), "id": f"0-{i}"} for i in range(2, 6)]
    saved["count"] = len(saved["results"])
    analyzers.persist_run(case, saved)
    base = f"/api/cases/{case.id}/analysis/runs/{saved['id']}"
    assert client.patch(base + "/results/0-2", json={"review": "noted"}).status_code == 200
    assert client.post(base + "/results/0-3/promote", json={"title": "Pinned"}).status_code == 200
    assert client.patch(base + "/results/0-4", json={"review": "dismissed"}).status_code == 200
    before = analyzers.read(case, "runs", saved["id"])
    other = run(client, case, body)
    # The other run already has its entity and frames before the bulk action.
    entities = case.list_entities()
    files = sorted(str(path.relative_to(case.path)) for path in case.path.rglob("*") if path.is_file())
    response = client.post(base + "/results/keep", json={})
    assert response.status_code == 200, response.text
    kept = response.json()
    assert kept["count"] == before["count"] == 4
    assert [row["review"] for row in kept["results"]] == ["noted", "noted", "kept", "noted"]
    for row in before["results"]:
        actual = next(item for item in kept["results"] if item["id"] == row["id"])
        if row["review"] != "new":
            assert actual == row
        else:
            assert actual["reviewed_at"] and actual["entity_id"] is None
    assert analyzers.read(case, "runs", saved["id"]) == kept
    assert analyzers.read(case, "runs", other["id"]) == other
    assert case.list_entities() == entities
    assert sorted(str(path.relative_to(case.path)) for path in case.path.rglob("*") if path.is_file()) == files
    assert client.post(base + "/results/keep", json={}).json() == kept
    assert client.patch(base + "/results/0-5", json={"review": "dismissed"}).status_code == 200
    assert [row["id"] for row in client.get(base).json()["results"]] == [saved["results"][0]["id"], "0-2", "0-3"]


@pytest.mark.parametrize("status", ["queued", "running", "failed", "cancelled", "no_new_imagery"])
def test_keep_all_requires_a_completed_run(client, scenario, status):
    case, body = scenario
    saved = run(client, case, body)
    saved["status"] = status
    path = case.resolve_inside(analyzers.relpath("runs", saved["id"]))
    media.write_json_atomic(path, saved)
    before = path.read_bytes()
    response = client.post(f"/api/cases/{case.id}/analysis/runs/{saved['id']}/results/keep", json={})
    assert response.status_code == 409
    assert path.read_bytes() == before


def test_keep_all_accepts_an_empty_completed_run_and_rejects_a_missing_run(client, scenario):
    case, body = scenario
    saved = run(client, case, body)
    saved.update(results=[], count=0)
    analyzers.persist_run(case, saved)
    base = f"/api/cases/{case.id}/analysis/runs"
    assert client.post(base + f"/{saved['id']}/results/keep", json={}).json() == saved
    assert client.post(base + "/000000000000/results/keep", json={}).status_code == 404


def test_dismiss_removes_and_keep_creates_no_entity_or_media(client, scenario):
    case, body = scenario
    saved = run(client, case, body)
    endpoint = f"/api/cases/{case.id}/analysis/runs/{saved['id']}/results/{saved['results'][0]['id']}"
    before = case.list_entities()
    assert client.patch(endpoint, json={"review": "noted"}).status_code == 200
    assert case.list_entities() == before
    assert client.patch(endpoint, json={"review": "dismissed"}).status_code == 200
    assert analyzers.read(case, "runs", saved["id"])["results"] == []
    assert client.get(endpoint + "/preview").status_code == 404
    assert run(client, case, body)["count"] == 1


@pytest.mark.parametrize("shape", ["point", "area"])
def test_pin_options_choose_image_and_geometry(client, scenario, shape):
    case, body = scenario
    saved = run(client, case, body)
    endpoint = f"/api/cases/{case.id}/analysis/runs/{saved['id']}/results/{saved['results'][0]['id']}"
    with Image.open(io.BytesIO(client.get(endpoint + "/preview").content)) as image:
        paired_width = image.width
    response = client.post(endpoint + "/promote", json={"title": "Checked", "description": "Observed change",
                           "after_only": True, "shape": shape})
    assert response.status_code == 200, response.text
    pinned = response.json()
    with Image.open(case.resolve_inside(pinned["image"])) as image:
        assert image.format == "PNG" and image.width == (paired_width - 8) // 2
    attrs = pinned["entity"]["attrs"]
    assert attrs["description"] == "Observed change"
    assert attrs["geometry"]["type"] == ("Polygon" if shape == "area" else "Point")
    assert ("footprint" in attrs) == (shape == "area")


def test_mask_outlines_preserve_an_l_hole_and_diagonal_parts():
    mask = np.zeros((8, 8), bool)
    mask[1:7, 1:3] = True
    mask[5:7, 1:7] = True
    shape = analysis_geometry.footprint(mask, 0, 0, 1, 8)
    assert shape["type"] == "Polygon" and len(shape["coordinates"][0]) == 7
    assert np.count_nonzero(mask) == 20  # tracing did not change the detector output
    hole = np.ones((5, 5), bool)
    hole[2, 2] = False
    assert len(analysis_geometry.outlines(hole)[0]) == 2
    diagonal = analysis_geometry.footprint(np.eye(3, dtype=bool), 0, 0, 1, 8)
    assert diagonal["type"] == "MultiPolygon" and len(diagonal["coordinates"]) == 3


def test_merge_keeps_the_parts_footprints():
    shape = {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]}
    rows = [{"id": str(i), "bbox": [i, 0, i + 1, 1], "geometry": shape, "margin": 1,
             "area": 1, "parts": [], "measure": {}, "strength": "clear"} for i in range(2)]
    [merged] = analyzers.merge(rows, 0)
    assert merged["geometry"] == {"type": "MultiPolygon", "coordinates": [shape["coordinates"], shape["coordinates"]]}


def test_manual_candidate_survives_reload_and_has_the_same_preview_and_verdicts(client, scenario):
    case, body = scenario
    saved = run(client, case, body)
    base = f"/api/cases/{case.id}/analysis/runs/{saved['id']}"
    point = saved["results"][0]["coordinates"]
    response = client.post(base + "/results", json={"area_id": "patch", "geometry": {"type": "Point", "coordinates": point}})
    assert response.status_code == 200, response.text
    manual = response.json()
    assert manual["origin"] == "manual" and manual["sources"]["b"] == body["b"]
    assert client.get(base + f"/results/{manual['id']}/preview").content.startswith(b"\x89PNG")
    assert client.get(base).json()["results"][-1] == manual
    assert client.patch(base + f"/results/{manual['id']}", json={"review": "noted"}).status_code == 200
    assert client.delete(base).status_code == 200


def test_exact_repeat_warns_before_queueing_but_overlap_does_not(client, scenario):
    case, body = scenario
    first = run(client, case, body)
    base = f"/api/cases/{case.id}/analysis/runs"
    repeat = client.post(base, json=body).json()
    assert repeat["duplicates"][0]["run_id"] == first["id"]
    assert len(analyzers.listing(case, "runs")) == 1
    overlap = {**body, "a": {**body["a"], "date": "2026-05-03"}}
    seed_images(overlap)
    assert "id" in client.post(base, json=overlap).json()
    assert "id" in client.post(base, json={**repeat["input"], "run_anyway": True}).json()


def test_export_snapshots_kept_candidates_with_pass_categories_and_replaces_a_pass(client, scenario):
    case, body = scenario
    base = f"/api/cases/{case.id}/analysis"
    watch = client.post(base + "/followups", json=body).json()
    first = run(client, case, {**body, "followup_id": watch["id"]})
    first_url = base + f"/runs/{first['id']}"
    client.patch(first_url + f"/results/{first['results'][0]['id']}", json={"review": "noted"})
    exported = client.post(first_url + "/export").json()
    later = {**body, "followup_id": watch["id"], "b": {**body["b"], "date": "2026-05-18"}}
    seed_images(later)
    second = run(client, case, later)
    second_url = base + f"/runs/{second['id']}"
    # New candidates are excluded.
    assert client.post(second_url + "/export").json()["features"] == 1
    client.post(second_url + f"/results/{second['results'][0]['id']}/promote", json={"title": "Pinned"})
    updated = client.post(second_url + "/export").json()
    assert updated["name"] == exported["name"] and updated["features"] == 2
    assert {c["name"] for c in updated["categories"]} == {"2026-05-11", "2026-05-18"}
    assert client.post(second_url + "/export").json()["features"] == 2
    drawing = json.loads(maplayers.drawing(case, updated["name"]).read_text())
    features = sorted(drawing["features"], key=lambda f: f["properties"]["pass_date"])
    assert int(features[0]["properties"]["colour"][1:3], 16) > int(features[1]["properties"]["colour"][1:3], 16)
    assert all(f["properties"]["run_id"] and f["properties"]["area_name"] for f in features)
    # A change spans the passes it was read between, which is what the layer's
    # time filter compares; the day it was found stays its group.
    assert [(f["properties"]["date"], f["properties"]["date_end"]) for f in features] == [
        (body["a"]["date"], "2026-05-11"), (body["a"]["date"], "2026-05-18")]
    assert all(f["properties"]["pass_before"] == body["a"]["date"] for f in features)
    assert client.delete(first_url).status_code == 200
    assert client.delete(second_url).status_code == 200
    # Rebuild from the portable snapshot, without a run or the derived cache.
    case.resolve_inside(layout.layer_cache_rel(updated["name"])).unlink()
    assert len(json.loads(maplayers.drawing(case, updated["name"]).read_text())["features"]) == 2


def test_detect_preferences_round_trip_through_settings_backup(client):
    choice = {"collapsed": True, "basemap": "osm", "overlays": ["roads"], "saved": False,
              "width": 480}
    assert client.put("/api/settings/prefs", json={"detect_view": choice}).status_code == 200
    backup = client.get("/api/settings/export").json()
    client.put("/api/settings/prefs", json={"detect_view": {}})
    assert client.post("/api/settings/import", json=backup).status_code == 200
    assert client.get("/api/settings").json()["detect_view"] == choice


def test_shared_areas_and_routine_references_survive_a_bundle(client, scenario):
    case, body = scenario
    watch = analyzers.save(case, "followups", body)
    original = analyzers.read(case, "followups", watch["id"])
    area = analyzers.read(case, "areas", watch["area_dates"][0]["area_id"])
    destination = Case.create("Imported areas")
    bundles.import_into(destination, bundles.export_case(case))
    imported = Case.open(destination.id)
    assert analyzers.read(imported, "followups", watch["id"]) == original
    assert analyzers.read(imported, "areas", area["id"]) == area
    assert imported.find_entity(attr="spec", value=analyzers.relpath("areas", area["id"]))


def test_previous_pass_finds_a_run_made_before_shared_area_migration(client, scenario):
    case, body = scenario
    watch = analyzers.save(case, "followups", body)
    earlier = run(client, case, {**body, "followup_id": watch["id"]})
    earlier.pop("area_runs")
    media.write_json_atomic(case.resolve_inside(analyzers.relpath("runs", earlier["id"])), earlier)
    shared = analyzers.read(case, "followups", watch["id"])
    later = RunInput.model_validate({**body, "zones": shared["zones"], "followup_id": watch["id"],
                                    "b": {**body["b"], "date": "2026-05-20"}})
    assert analyzers.previous_pass(case, later).date == body["b"]["date"]


@pytest.mark.parametrize("recipe_id", ["boats", "anomaly"])
def test_single_image_methods_need_no_reference_and_pin_after_only(client, scenario, recipe_id):
    case, _ = scenario
    body = sentinel_input(recipe_id, min_area=0, merge_metres=0)
    body["a"]["date"] = ""
    pixels = sea() if recipe_id == "boats" else fire_frame()
    if recipe_id == "boats":
        hull(pixels, 120, 140, 6, 3)
    else:
        flame(pixels, 120, 140, 6, 3)
    seed(body, after=pixels)
    body["area_dates"] = [{"area_id": "patch", "b": body["b"], "date_rule": "manual"}]
    saved = run(client, case, body)
    assert saved["status"] == "ready" and saved["count"] == 1, saved
    assert saved["area_runs"][0]["a"] == saved["area_runs"][0]["b"]
    result = saved["results"][0]
    assert len(result["parts"][0]["frames"]) == 1
    endpoint = f"/api/cases/{case.id}/analysis/runs/{saved['id']}/results/{result['id']}"
    pinned = client.post(endpoint + "/promote", json={"title": "Observed"})
    assert pinned.status_code == 200, pinned.text
    assert pinned.json()["entity"]["attrs"]["geometry"]["type"] == "Point"
    with Image.open(case.resolve_inside(pinned.json()["image"])) as image:
        assert image.format == "PNG" and image.width <= 400


def _routine_on_its_own_area(client, case, body, title="Harbour watch"):
    base = f"/api/cases/{case.id}/analysis"
    area = client.post(base + "/areas", json={**area_body(body["zones"][0]), "name": "Harbour"}).json()
    shared = {**body, "zones": [], "area_dates": [{"area_id": area["id"], "a": body["a"], "b": body["b"], "date_rule": "manual"}]}
    routine = client.post(base + "/followups", json={**shared, "title": title}).json()
    return base, area, routine


def test_a_routine_is_not_restored_without_the_area_it_draws_on(client, scenario):
    case, body = scenario
    base, area, routine = _routine_on_its_own_area(client, case, body)
    routine_group = client.delete(base + "/followups/" + routine["id"]).json()["trash"]
    area_group = client.delete(base + "/areas/" + area["id"]).json()["trash"]

    refused = client.post(f"/api/cases/{case.id}/trash/{routine_group}/restore")
    assert refused.status_code == 409
    assert "Harbour" in refused.json()["detail"] and "restore" in refused.json()["detail"]
    assert client.get(base + "/followups").json() == []

    assert client.post(f"/api/cases/{case.id}/trash/{area_group}/restore").status_code == 200
    assert client.post(f"/api/cases/{case.id}/trash/{routine_group}/restore").status_code == 200
    assert [row["id"] for row in client.get(base + "/followups").json()] == [routine["id"]]
    opened = client.get(base + "/followups/" + routine["id"]).json()
    assert opened["zones"][0]["name"] == "Harbour" and "missing_areas" not in opened


def test_a_routine_whose_area_is_gone_for_good_still_opens_and_says_so(client, scenario):
    case, body = scenario
    base, area, routine = _routine_on_its_own_area(client, case, body)
    routine_group = client.delete(base + "/followups/" + routine["id"]).json()["trash"]
    area_group = client.delete(base + "/areas/" + area["id"]).json()["trash"]
    assert client.delete(f"/api/cases/{case.id}/trash/{area_group}").status_code == 200

    assert client.post(f"/api/cases/{case.id}/trash/{routine_group}/restore").status_code == 200

    assert [row["id"] for row in client.get(base + "/followups").json()] == [routine["id"]]
    opened = client.get(base + "/followups/" + routine["id"]).json()
    assert opened["zones"] == [] and opened["missing_areas"] == [area["id"]]
    ran = client.post(base + "/followups/" + routine["id"] + "/run", json={})
    assert ran.status_code == 422 and "area" in ran.json()["detail"]
