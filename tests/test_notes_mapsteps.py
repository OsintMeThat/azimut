"""Steps from a layer (`engine/notes_mapsteps.py`, `POST /notes/maps/steps`): a note map's story
steps made from one of its layers, one a day of its dated marks inside an area and a period,
each lighting its marks when it comes."""

from __future__ import annotations

import pytest

from azimut.engine import layerediting, notes_maps, notes_mapsteps
from azimut.engine import uses as uses_engine

from test_notes_maps import _case, _note_with, _proof

#: Round Bab al-Mandab, as a map framed on it shows it.
AREA = [43.40, 12.60, 43.60, 12.90]


def _front(client, cid, case) -> tuple[str, dict[str, str]]:
    """A layer of geolocations over a whole country: four dated marks round the strait (two on
    one day), one with no day there, and one dated far away in Sanaa. Each mark named after its
    picture, a proof of the case."""
    name = layerediting.create(case, "Geolocations Yemen")["name"]
    pictures: dict[str, str] = {}
    for label, lat, lon, day, words in [
        ("South of the lagoon", 12.6894, 43.4721, "2026-09-14", "A Houthi camera south of the lagoon."),
        ("The assault video", 12.7462, 43.4945, "2026-10-14", "Footage of the assault."),
        ("The north edge", 12.7377, 43.5017, "2026-10-14", ""),
        ("Dhubab airport", 12.8636, 43.5205, "2026-11-13", "Inside the airport."),
        ("Somewhere near", 12.7400, 43.5000, "", ""),
        ("Sanaa", 15.3500, 44.2000, "2026-10-01", ""),
    ]:
        proof = _proof(client, cid, label, day or "2026-10-01", [(f"{lat}, {lon}", "Spot", False)])
        pictures[label] = proof["id"]
        layerediting.add_marker(case, name, lat=lat, lon=lon, name=label, colour="#e53935", symbol="pin",
                                description=words, picture=proof["id"], **({"date": day} if day else {}))
    return name, pictures


def test_a_layer_makes_one_step_a_day_of_its_dated_marks_inside_the_area(client):
    cid, case = _case(client)
    layer, pictures = _front(client, cid, case)
    made = notes_mapsteps.steps_from_layer(case, notes_maps.parse_block(f"layer: {layer}"), layer, within=AREA)
    # Sanaa lies outside the area, and the mark with no day is counted apart
    assert (made["marks"], made["days"], made["undated"], made["more"]) == (4, 3, 1, 0)
    assert (made["first"], made["last"]) == ("2026-09-14", "2026-11-13"), "the layer's own span, for the dates"
    assert [step["day"] for step in made["steps"]] == ["2026-09-14", "2026-10-14", "2026-11-13"]
    lone, two, _airport = made["steps"]
    assert lone["label"] == "South of the lagoon" and lone["words"] == "A Houthi camera south of the lagoon."
    assert lone["proof"] == pictures["South of the lagoon"]
    # two marks on one day are one step, named by its day, its words their names, lighting both
    assert two["label"] == "14 October 2026" and two["words"] == "The assault video and The north edge"
    assert two["proof"] == f"{pictures['The assault video']}, {pictures['The north edge']}"
    # a lone point is looked at no closer than the area's own scale allows, the land round it in view
    closest = notes_maps.fit_view(AREA, *notes_mapsteps.FRAME)[2] + notes_mapsteps.CLOSER
    assert lone["view"][2] == pytest.approx(closest, abs=0.01)
    assert lone["view"][:2] == pytest.approx([12.6894, 43.4721], abs=1e-4)
    # the whole layer, with no area, takes Sanaa in too
    everywhere = notes_mapsteps.steps_from_layer(case, notes_maps.parse_block(f"layer: {layer}"), layer)
    assert [step["day"] for step in everywhere["steps"]] == ["2026-09-14", "2026-10-01", "2026-10-14", "2026-11-13"]


def test_the_period_keeps_its_days_either_end_open_or_written_backwards(client):
    cid, case = _case(client)
    layer, _ = _front(client, cid, case)
    block = notes_maps.parse_block(f"layer: {layer}")
    october = notes_mapsteps.steps_from_layer(case, block, layer, within=AREA, start="2026-10-01", end="2026-10-31")
    assert [step["day"] for step in october["steps"]] == ["2026-10-14"] and october["marks"] == 2
    backwards = notes_mapsteps.steps_from_layer(case, block, layer, within=AREA, start="2026-10-31", end="2026-10-01")
    assert backwards["steps"] == october["steps"]
    since = notes_mapsteps.steps_from_layer(case, block, layer, within=AREA, start="2026-10-15")
    assert [step["day"] for step in since["steps"]] == ["2026-11-13"]
    assert october["undated"] == 1, "a mark with no day is said whatever the period"


def test_a_name_too_long_to_be_one_becomes_the_steps_words_the_step_named_by_its_day(client):
    cid, case = _case(client)
    name = layerediting.create(case, "Brought in")["name"]
    said = ("Yemeni forces spotted engaging Houthi fighters entrenched on the heights along the main road "
            "north of the strait, filmed from the east")
    layerediting.add_marker(case, name, lat=12.74, lon=43.50, name=said, colour="#e53935", symbol="pin", date="2026-10-19")
    layerediting.add_marker(case, name, lat=12.75, lon=43.51, name="Short", colour="#e53935", symbol="pin",
                            description="Its own words.", date="2026-10-20")
    made = notes_mapsteps.steps_from_layer(case, notes_maps.parse_block(f"layer: {name}"), name, within=AREA)
    long, short = made["steps"]
    assert (long["label"], long["words"]) == ("19 October 2026", said)
    assert (short["label"], short["words"]) == ("Short", "Its own words.")


def test_a_map_holds_sixty_steps_and_says_how_many_days_are_left(client, monkeypatch):
    cid, case = _case(client)
    layer, _ = _front(client, cid, case)
    monkeypatch.setattr(notes_maps, "MAX_STEPS", 2)
    made = notes_mapsteps.steps_from_layer(case, notes_maps.parse_block(f"layer: {layer}"), layer, within=AREA)
    assert [step["day"] for step in made["steps"]] == ["2026-09-14", "2026-10-14"]
    assert (made["days"], made["more"]) == (3, 1)


def test_a_layer_hidden_on_the_map_or_not_on_it_makes_no_steps(client):
    cid, case = _case(client)
    layer, _ = _front(client, cid, case)
    with pytest.raises(notes_mapsteps.StepsError, match="hidden"):
        notes_mapsteps.steps_from_layer(case, notes_maps.parse_block(f"layer: {layer}\nhide: {layer}"), layer)
    with pytest.raises(notes_mapsteps.StepsError, match="not on this map"):
        notes_mapsteps.steps_from_layer(case, notes_maps.parse_block("layer: Another"), layer)


def test_a_group_the_layer_hides_is_never_counted(client):
    cid, case = _case(client)
    name = layerediting.create(case, "Sides")["name"]
    for group, day in (("Government", "2026-10-09"), ("Houthi", "2026-10-14")):
        made = layerediting.add_group(case, name, group)
        layerediting.add_marker(case, name, lat=12.74, lon=43.50, name=group, colour="#e53935", symbol="pin",
                                group=made["group"]["id"], date=day)
    with case.lock:
        spec = layerediting._spec(case, name)
        spec["hidden"] = ["Houthi"]
        layerediting._save(case, name, spec)
    made = notes_mapsteps.steps_from_layer(case, notes_maps.parse_block(f"layer: {name}"), name, within=AREA)
    assert [step["label"] for step in made["steps"]] == ["Government"]


def test_the_steps_written_light_their_marks_and_a_hand_made_step_stays_as_it_was(client):
    cid, case = _case(client)
    layer, pictures = _front(client, cid, case)
    made = notes_mapsteps.steps_from_layer(case, notes_maps.parse_block(f"layer: {layer}"), layer, within=AREA)
    lines = [notes_maps.step_line(notes_maps.step_of_text(" | ".join(
        [step["day"], step["label"], ", ".join(str(value) for value in step["view"]), step["proof"], step["words"]])))
        for step in made["steps"]]
    text = "\n".join([f"layer: {layer}", *lines, "step: 2026-10-20 | By hand | 12.74, 43.50, 13 | | Written by hand."])
    derived = notes_maps.derive(case, notes_maps.parse_block(text))
    by_label = {feature["label"]: feature["id"] for feature in derived.data["features"]}
    steps = derived.data["steps"]
    assert steps[0]["focus"] == [by_label["South of the lagoon"]]
    assert steps[1]["focus"] == [by_label["The assault video"], by_label["The north edge"]]
    assert steps[3]["focus"] == [] and steps[3]["text"] == "Written by hand.", "a step naming nothing lights nothing"
    assert "name" not in steps[1], "only a proof the map shows gives a step its card's name"
    # every picture a step names is a use the delete preview says
    _note_with(client, cid, "::: map\n" + text + "\n:::\n")
    used = uses_engine.used_refs(case)
    assert pictures["The assault video"] in used and pictures["The north edge"] in used


def test_a_step_names_up_to_twelve_records_each_one_a_record():
    ids = ", ".join(f"e_{number}" for number in range(12))
    step = notes_maps.step_of_text("2026-10-14 | Two | 12.7, 43.5, 13 | e_a,e_b , e_a | Words | with a bar")
    assert step is not None and step.proof == "e_a, e_b" and step.words == "Words | with a bar"
    assert notes_maps.step_ids(step.proof) == ["e_a", "e_b"]
    assert notes_maps.step_of_text(f"2026-10-14 | Twelve | | {ids}") is not None
    assert notes_maps.step_of_text(f"2026-10-14 | Thirteen | | {ids}, e_12") is None
    assert notes_maps.step_of_text("2026-10-14 | Bad | | e_a, not/one") is None


def test_the_card_asks_the_server_which_checks_the_area_the_days_and_the_layer(client):
    cid, case = _case(client)
    layer, _ = _front(client, cid, case)
    url = f"/api/cases/{cid}/notes/maps/steps"
    text = f"::: map\nlayer: {layer}\n:::"
    answer = client.post(url, json={"text": text, "layer": layer, "within": AREA, "start": "2026-10-01"})
    assert answer.status_code == 200, answer.text
    assert [step["day"] for step in answer.json()["steps"]] == ["2026-10-14", "2026-11-13"]
    assert client.post(url, json={"text": text, "layer": layer, "within": [43.6, 12.6, 43.4, 12.9]}).status_code == 422
    assert client.post(url, json={"text": text, "layer": layer, "within": [43.4, 12.6, 43.6]}).status_code == 422
    assert client.post(url, json={"text": text, "layer": layer, "start": "14 Oct"}).status_code == 422
    missing = client.post(url, json={"text": text, "layer": "Another"})
    assert missing.status_code == 404 and missing.json()["detail"] == "That layer is not on this map."
