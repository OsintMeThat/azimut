"""A kept Detect candidate says when it was seen, on its picture and on a Claim."""

import json

import pytest

from azimut import workspace
from azimut.engine import analysis_dating, maplayers, media
from azimut.workspace import Case
from analyzerfixture import DAY_A, DAY_B, hull, sea, seed, sentinel_input
from test_analyzers import run, scenario as analyzer_scenario


@pytest.fixture
def scenario(client, monkeypatch):
    return analyzer_scenario.__wrapped__(client, monkeypatch)


def kept(client, case, saved, **pin):
    result = saved["results"][0]
    endpoint = f"/api/cases/{case.id}/analysis/runs/{saved['id']}/results/{result['id']}"
    response = client.post(endpoint + "/promote", json={"title": "Levelled yard", **pin})
    assert response.status_code == 200, response.text
    return endpoint, response.json()


def links_of(case, claim_id, type_):
    return [link["to"] for link in case.links_of(claim_id) if link["type"] == type_ and link["from"] == claim_id]


def time_rows(client, case, entity_id):
    page = client.get(f"/api/cases/{case.id}/timeline", params={
        "entity": entity_id, "category": ["statement", "media"], "include_undated": "true"}).json()
    return {row["kind"]: row for row in page["items"] if row["owner_id"] == entity_id}


def one_pass_run(client, case):
    body = sentinel_input("boats", min_area=0, merge_metres=0)
    body["a"]["date"] = ""
    pixels = sea()
    hull(pixels, 120, 140, 6, 3)
    seed(body, after=pixels)
    body["area_dates"] = [{"area_id": "patch", "b": body["b"], "date_rule": "manual"}]
    saved = run(client, case, body)
    assert saved["count"] == 1, saved
    return saved


# -- the pieces --------------------------------------------------------------------


def test_a_pass_is_its_day_or_the_instant_a_radar_pass_names():
    assert analysis_dating.moment({"date": "2026-05-11"}) == "2026-05-11"
    assert analysis_dating.moment({"date": "2026-05-11", "time": "05:42:10"}) == "2026-05-11T05:42:10Z"
    assert analysis_dating.moment({"date": ""}) == ""
    assert analysis_dating.moment({"date": "11/05/2026"}) == ""


def test_a_change_happened_between_its_passes_in_the_order_they_happened():
    assert analysis_dating.span("2026-05-04", "2026-05-11") == "2026-05-04/2026-05-11"
    assert analysis_dating.span("2026-05-11", "2026-05-04") == "2026-05-04/2026-05-11"
    # two radar looks on one day are an exact interval
    assert (analysis_dating.span("2026-05-11T05:42:10Z", "2026-05-11T17:31:02Z")
            == "2026-05-11T05:42:10Z/2026-05-11T17:31:02Z")
    # a day and an instant do not mix in the profile, so both are read as days
    assert analysis_dating.span("2026-05-04", "2026-05-11T05:42:10Z") == "2026-05-04/2026-05-11"
    assert analysis_dating.span("2026-05-11", "2026-05-11T05:42:10Z") == "2026-05-11"


def test_a_picture_of_two_passes_carries_two_dates_and_one_pass_carries_one():
    sources = {"a": {"date": DAY_A}, "b": {"date": DAY_B, "time": "05:42:10"}}
    assert analysis_dating.pictured(sources, one_pass=False) == {
        "imagery_a": DAY_A, "imagery_b": f"{DAY_B}T05:42:10Z"}
    assert analysis_dating.pictured(sources, one_pass=True) == {"imagery_date": f"{DAY_B}T05:42:10Z"}
    assert analysis_dating.pictured({"a": {}, "b": {}}, one_pass=True) == {}


# -- keeping -------------------------------------------------------------------------


def test_keeping_a_change_states_it_happened_between_the_passes(client, scenario):
    case, body = scenario
    saved = run(client, case, body)
    _, pinned = kept(client, case, saved)
    place = pinned["entity"]
    picture = case.find_entity(attr="path", value=pinned["image"])

    # The place carries no date of its own: a pin is permanent ground.
    assert not {"when", "imagery_date"} & set(place["attrs"])
    claim = case.get_entity(pinned["claim"]["id"])
    assert claim["type"] == "claim" and claim["label"] == "Changed: Levelled yard"
    assert claim["attrs"]["when"] == f"{DAY_A}/{DAY_B}"
    assert claim["attrs"]["time_role"] == "occurred"
    # keeping is the review, but nobody graded the statement
    assert "confidence" not in claim["attrs"]
    assert links_of(case, claim["id"], "at") == [place["id"]]
    assert links_of(case, claim["id"], "cites") == [picture["id"]]

    # The picture shows both passes, as two dates rather than a range.
    source = media.read_item(case, pinned["image"])["source"]
    assert (source["imagery_a"], source["imagery_b"]) == (DAY_A, DAY_B)
    rows = time_rows(client, case, picture["id"])
    assert rows["imagery-a"]["raw"] == DAY_A and rows["imagery-b"]["raw"] == DAY_B
    assert time_rows(client, case, claim["id"])["claim"]["shape"] == "interval"


def test_a_change_kept_as_its_second_pass_names_that_pass_alone(client, scenario):
    case, body = scenario
    saved = run(client, case, body)
    _, pinned = kept(client, case, saved, after_only=True)
    source = media.read_item(case, pinned["image"])["source"]
    assert source["imagery_date"] == DAY_B
    assert "imagery_a" not in source
    # what the sweep read is still a change between two passes
    assert case.get_entity(pinned["claim"]["id"])["attrs"]["when"] == f"{DAY_A}/{DAY_B}"


def test_keeping_a_thing_on_one_pass_states_it_was_seen_then(client, scenario):
    case, _ = scenario
    saved = one_pass_run(client, case)
    _, pinned = kept(client, case, saved, title="Tanker")
    claim = case.get_entity(pinned["claim"]["id"])
    assert claim["label"] == "Seen: Tanker"
    assert (claim["attrs"]["when"], claim["attrs"]["time_role"]) == (DAY_B, "observed")
    assert media.read_item(case, pinned["image"])["source"]["imagery_date"] == DAY_B


def test_undoing_a_pin_takes_its_statement_to_the_same_trash_group(client, scenario):
    case, body = scenario
    saved = run(client, case, body)
    endpoint, pinned = kept(client, case, saved)
    claim_id = pinned["claim"]["id"]
    undone = client.delete(endpoint + "/promote").json()
    assert set(undone["deleted"]["deleted"]) >= {pinned["entity"]["id"], claim_id}
    assert case.get_entity(claim_id) is None
    restored = client.post(f"/api/cases/{case.id}/trash/{undone['deleted']['trash']}/restore")
    assert restored.status_code == 200, restored.text
    assert case.get_entity(claim_id) and case.get_entity(pinned["entity"]["id"])


def test_a_statement_the_analyst_worked_on_outlives_the_pin(client, scenario):
    case, body = scenario
    saved = run(client, case, body)
    endpoint, pinned = kept(client, case, saved)
    claim_id = pinned["claim"]["id"]
    assert client.patch(f"/api/cases/{case.id}/timeline/claims/{claim_id}",
                        json={"confidence": "probable"}).status_code == 200
    client.delete(endpoint + "/promote")
    assert case.get_entity(pinned["entity"]["id"]) is None
    assert case.get_entity(claim_id)["attrs"]["confidence"] == "probable"


# -- pins kept before this -----------------------------------------------------------


def _forget_dates(case, pinned):
    """Rewind a pin to what an older build kept: no statement, an undated picture."""
    client_claim = pinned["claim"]["id"]
    case.remove_entity(client_claim)
    item = media.read_item(case, pinned["image"])
    source = {k: v for k, v in item["source"].items() if not k.startswith("imagery")}
    media.merge_item(case, pinned["image"], {"source": source})


def test_backfill_states_pins_kept_before_and_runs_once(client, scenario):
    case, _ = scenario
    saved = one_pass_run(client, case)
    _, pinned = kept(client, case, saved, title="Tanker")
    _forget_dates(case, pinned)

    assert analysis_dating.backfill(case) == 1
    claim = analysis_dating.standing(case, saved["id"], saved["results"][0]["id"])
    assert claim["attrs"]["when"] == DAY_B
    assert links_of(case, claim["id"], "at") == [pinned["entity"]["id"]]
    assert media.read_item(case, pinned["image"])["source"]["imagery_date"] == DAY_B
    assert analysis_dating.backfill(case) == 0


def test_backfill_leaves_a_change_picture_undated_since_its_shape_was_not_kept(client, scenario):
    case, body = scenario
    saved = run(client, case, body)
    _, pinned = kept(client, case, saved)
    _forget_dates(case, pinned)
    assert analysis_dating.backfill(case) == 1
    assert not any(k.startswith("imagery") for k in media.read_item(case, pinned["image"])["source"])


def test_opening_a_case_from_an_earlier_build_dates_its_pins(client, scenario):
    case, body = scenario
    saved = run(client, case, body)
    _, pinned = kept(client, case, saved)
    _forget_dates(case, pinned)
    manifest = case.read()
    manifest["azimut"]["schema"] = workspace.WORK_SCHEMA
    case._write_json(manifest)

    opened = Case.open(case.id)
    assert opened.read()["azimut"]["schema"] == workspace.CASE_SCHEMA
    claim = analysis_dating.standing(opened, saved["id"], saved["results"][0]["id"])
    assert claim["attrs"]["when"] == f"{DAY_A}/{DAY_B}"


# -- the SAT layer -------------------------------------------------------------------


def test_a_thing_on_one_pass_is_exported_on_that_day_alone(client, scenario):
    case, _ = scenario
    saved = one_pass_run(client, case)
    kept(client, case, saved, title="Tanker")
    exported = client.post(f"/api/cases/{case.id}/analysis/runs/{saved['id']}/export").json()
    feature = json.loads(maplayers.drawing(case, exported["name"]).read_text())["features"][0]
    assert feature["properties"]["date"] == DAY_B
    assert "date_end" not in feature["properties"] and "pass_before" not in feature["properties"]
