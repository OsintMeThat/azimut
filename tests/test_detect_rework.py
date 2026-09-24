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
from analyzerfixture import SENTINEL_TILE, fire_frame, flame, hull, sea, seed, seed_images, sentinel_input, zone
from test_analyzers import run, scenario as analyzer_scenario


@pytest.fixture
def scenario(client, monkeypatch):
    return analyzer_scenario.__wrapped__(client, monkeypatch)


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
    def lookup(instance, rings, start, end, collection="sentinel2"):
        calls.append(rings)
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
    choice = {"collapsed": True, "basemap": "osm", "overlays": ["roads"], "saved": False}
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
