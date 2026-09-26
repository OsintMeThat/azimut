"""Detect keeps working over what an earlier version saved.

A run, a routine or an analyzer is written once and read back by every later
version. One run that still carried a field the analyzer builder had renamed
made every launch in its case a server error, because the repeat check read
all the case's runs strictly. These gates plant such fields at every depth and
walk each road that reads them back.
"""

import json

import pytest

from azimut.engine import analyzers, media, workqueue
from azimut.engine.analysis_models import BUILTINS
from analyzerfixture import seed_images
from test_analyzers import run, scenario as analyzer_scenario


@pytest.fixture
def scenario(client, monkeypatch):
    return analyzer_scenario.__wrapped__(client, monkeypatch)


def rewrite(case, kind, ident, change):
    path = case.resolve_inside(analyzers.relpath(kind, ident))
    saved = json.loads(path.read_text(encoding="utf-8"))
    change(saved)
    media.write_json_atomic(path, saved)


#: What DetectWizard's submit sends, each part as the saved detection had it.
WIZARD = ("title", "note", "recipe", "a", "b", "zones", "area_dates", "date_rule", "offline")


def drift(body):
    """Fields no version of today's models knows, at every depth of a detection."""
    body["recipe"]["tests"] = []
    body["recipe"]["parameters"]["retired"] = 1
    body["a"]["retired"] = "x"
    body["b"]["retired"] = "x"
    for zone in body.get("zones", []):
        zone["retired"] = True
    for pair in body.get("area_dates", []):
        pair["retired"] = True
        pair["b"]["retired"] = "x"
    body["retired"] = True


def test_a_run_with_fields_a_later_version_dropped_still_launches_reviews_and_repeats(client, scenario):
    case, body = scenario
    first = run(client, case, body)
    base = f"/api/cases/{case.id}/analysis"

    def old(saved):
        drift(saved["input"])
        for outcome in saved["area_runs"]:
            outcome["b"]["retired"] = "x"
    rewrite(case, "runs", first["id"], old)

    # The launch that used to fail on the repeat check: the same detection is
    # still recognised as a repeat, and new dates still start.
    repeat = client.post(base + "/runs", json=body)
    assert repeat.status_code == 200, repeat.text
    assert repeat.json()["duplicates"][0]["run_id"] == first["id"]
    later = {**body, "b": {**body["b"], "date": "2026-05-18"}}
    seed_images(later)
    started = client.post(base + "/runs", json=later)
    assert started.status_code == 200 and "id" in started.json(), started.text

    loaded = client.get(base + f"/runs/{first['id']}").json()
    assert "tests" not in loaded["input"]["recipe"] and "retired" not in loaded["input"]["a"]
    # Edit this run: the wizard sends its parts back as it read them.
    edited = {key: loaded["input"][key] for key in WIZARD}
    again = client.post(base + "/runs", json={**edited, "run_anyway": True})
    assert again.status_code == 200, again.text

    candidate = loaded["results"][0]
    manual = client.post(base + f"/runs/{first['id']}/results", json={
        "area_id": candidate["area_id"], "geometry": {"type": "Point", "coordinates": candidate["coordinates"]}})
    assert manual.status_code == 200, manual.text
    kept = client.post(base + f"/runs/{first['id']}/results/{candidate['id']}/promote", json={"title": "Pinned"})
    assert kept.status_code == 200, kept.text
    assert client.post(base + f"/runs/{first['id']}/export").status_code == 200
    row = next(row for row in client.get(base + "/runs").json() if row["id"] == first["id"])
    assert row["analyzer"] == body["recipe"]["name"]


def test_a_routine_with_dropped_fields_opens_saves_runs_and_remembers(client, scenario):
    case, body = scenario
    base = f"/api/cases/{case.id}/analysis"
    watch = client.post(base + "/followups", json=body).json()
    first = run(client, case, {**body, "followup_id": watch["id"]})
    client.patch(base + f"/runs/{first['id']}/results/{first['results'][0]['id']}", json={"review": "noted"})
    rewrite(case, "followups", watch["id"], drift)
    rewrite(case, "runs", first["id"], lambda saved: drift(saved["input"]))

    opened = client.get(base + f"/followups/{watch['id']}").json()
    saved = client.put(base + f"/followups/{watch['id']}", json={key: opened[key] for key in WIZARD})
    assert saved.status_code == 200, saved.text
    assert len(client.get(base + f"/followups/{watch['id']}/findings").json()) == 1
    later = "2026-05-18"
    seed_images({**body, "b": {**body["b"], "date": later}})
    again = client.post(base + f"/followups/{watch['id']}/run", json={"date": later})
    assert again.status_code == 200 and "id" in again.json(), again.text


def unreadable_run(case, body, status):
    """A run whose recipe no longer reads at all, even with dropped fields ignored."""
    broken = {**body, "recipe": {**body["recipe"], "colour": "red"}}
    return analyzers.save(case, "runs", {
        "title": "Broken", "input": broken, "area_runs": [], "status": status, "progress": 0,
        "total": 1, "results": [], "frames": {}, "count": 0, "message": ""})


def test_a_run_that_no_longer_reads_blocks_nothing_and_fails_with_its_reason(client, scenario):
    case, body = scenario
    unreadable_run(case, body, "ready")
    base = f"/api/cases/{case.id}/analysis"
    started = client.post(base + "/runs", json=body)
    assert started.status_code == 200 and "id" in started.json(), started.text

    queued = unreadable_run(case, body, "queued")
    analyzers.execute(case, {"payload": {"run_id": queued["id"]}})
    failed = analyzers.read(case, "runs", queued["id"])
    assert failed["status"] == "failed"
    assert failed["message"].startswith("this detection no longer reads (recipe › colour: ")
    assert "pydantic" not in failed["message"]
    workqueue.drain(case)


def test_a_routine_that_no_longer_reads_says_where(client, scenario):
    case, body = scenario
    base = f"/api/cases/{case.id}/analysis"
    watch = client.post(base + "/followups", json=body).json()
    rewrite(case, "followups", watch["id"], lambda saved: saved["recipe"].update(colour="red"))
    refused = client.post(base + f"/followups/{watch['id']}/run", json={"date": body["b"]["date"]})
    assert refused.status_code == 422
    assert refused.json()["detail"].startswith("recipe › colour: ")


def test_a_request_naming_an_unknown_field_is_still_refused(client, scenario):
    case, body = scenario
    asked = {**body, "recipe": {**body["recipe"], "tests": []}}
    assert client.post(f"/api/cases/{case.id}/analysis/runs", json=asked).status_code == 422


def own_analyzer(**extra):
    return {**BUILTINS[0].model_dump(), "id": "custom-0123456789ab", "name": "Harbour boats", **extra}


def test_saved_analyzers_and_detect_view_survive_dropped_fields_in_settings_and_backups(client):
    from azimut import config

    def old(settings):
        settings["analyzers"] = [own_analyzer(tests=[])]
        settings["detect_view"] = {"collapsed": True, "basemap": "osm", "overlays": ["roads"],
                                   "saved": True, "retired": 1}
    config.update_settings(old)
    assert [r["name"] for r in client.get("/api/compare/analyzers").json()["custom"]] == ["Harbour boats"]
    view = client.get("/api/settings").json()["detect_view"]
    assert "retired" not in view and view["basemap"] == "osm"
    assert client.put("/api/settings/prefs", json={"detect_view": view}).status_code == 200

    backup = client.get("/api/settings/export").json()
    backup["settings"]["analyzers"] = [own_analyzer(tests=[]),
                                       own_analyzer(id="custom-ba0000000000", colour="red")]
    backup["settings"]["detect_view"] = {**view, "retired": 1}
    config.update_settings(lambda settings: settings.update(analyzers=[]))
    restored = client.post("/api/settings/import", json=backup)
    assert restored.status_code == 200, restored.text
    assert [r["id"] for r in client.get("/api/compare/analyzers").json()["custom"]] == ["custom-0123456789ab"]
    assert client.get("/api/settings").json()["detect_view"] == view
