"""A personal layer followed over time: dated states, the latest mirrored, and history exports."""

import io
import json
import zipfile
from xml.etree import ElementTree as ET

import pytest

from azimut.engine import layerediting

NS = {"k": "http://www.opengis.net/kml/2.2"}
LINE = [[30.0, 50.0], [30.1, 50.0]]
MOVED = [[30.0, 50.1], [30.1, 50.1]]
FURTHER = [[30.0, 50.2], [30.1, 50.2]]


@pytest.fixture
def owner(client):
    return client.post("/api/cases", json={"name": "Front lines"}).json()["id"]


def create(client, owner, *, tracked=True, precision="day", zone="UTC"):
    row = client.post(f"/api/cases/{owner}/map-layers/editable", json={"title": "Front"}).json()
    if tracked:
        answer = client.patch(f"{url_of(owner, row)}/edit", json={"track": {"on": True, "precision": precision, "zone": zone}})
        assert answer.status_code == 200, answer.text
    return row


def url_of(owner, row):
    return f"/api/cases/{owner}/map-layers/{row['name']}"


def add_line(client, owner, row, coordinates=LINE, **fields):
    answer = client.post(f"{url_of(owner, row)}/shapes",
                         json={"geometry": {"type": "LineString", "coordinates": coordinates}, **fields})
    assert answer.status_code == 200, answer.text
    return answer.json()["key"]


def edit(client, owner, row, key, **changes):
    return client.patch(f"{url_of(owner, row)}/markers/{key}", json=changes)


def feature(client, owner, row, key):
    document = client.get(f"{url_of(owner, row)}/edit").json()["document"]
    return next(f for f in document["features"] if f["properties"]["key"] == key)


def test_the_switch_is_off_by_default_and_its_settings_survive_switching_off(client, owner):
    row = create(client, owner, tracked=False)
    assert client.get(f"{url_of(owner, row)}/edit").json()["layer"]["track"] is None
    on = client.patch(f"{url_of(owner, row)}/edit", json={"track": {"on": True, "precision": "time", "zone": "Europe/Kyiv"}})
    assert on.json()["layer"]["track"] == {"on": True, "precision": "time", "zone": "Europe/Kyiv"}
    off = client.patch(f"{url_of(owner, row)}/edit", json={"track": {"on": False}})
    assert off.json()["layer"]["track"] == {"on": False, "precision": "time", "zone": "Europe/Kyiv"}


def test_events_stay_for_good_until_the_layer_keeps_them_some_days(client, owner):
    row = create(client, owner)
    # a layer that never said keeps its events on the map, faded
    assert "window" not in client.get(f"{url_of(owner, row)}/edit").json()["layer"]["track"]
    kept = client.patch(f"{url_of(owner, row)}/edit", json={"track": {"window": 10}})
    assert kept.json()["layer"]["track"]["window"] == 10
    # what the layer keeps is read back in the list every map reads
    listed = client.get(f"/api/cases/{owner}/map-layers").json()
    listed = listed["layers"] if isinstance(listed, dict) else listed
    assert next(item for item in listed if item["name"] == row["name"])["track"]["window"] == 10
    again = client.patch(f"{url_of(owner, row)}/edit", json={"track": {"window": "always"}})
    assert "window" not in again.json()["layer"]["track"]
    # switching tracking off and on leaves it as it was
    client.patch(f"{url_of(owner, row)}/edit", json={"track": {"window": 0}})
    client.patch(f"{url_of(owner, row)}/edit", json={"track": {"on": False}})
    back = client.patch(f"{url_of(owner, row)}/edit", json={"track": {"on": True}})
    assert back.json()["layer"]["track"]["window"] == 0


@pytest.mark.parametrize("window", [-1, 366, "forever", True])
def test_an_events_window_outside_its_range_is_refused(owner, window):
    spec: dict = {"track": {"on": True, "precision": "day", "zone": "UTC"}}
    with pytest.raises(layerediting.maplayers.LayerError):
        layerediting.set_track(spec, {"window": window})
    assert "window" not in spec["track"]


@pytest.mark.parametrize("track", [{"zone": "Mars/Olympus"}, {"precision": "week"}, {"window": 400}, {"window": "never"}])
def test_a_clock_or_a_precision_outside_the_list_is_refused(client, owner, track):
    row = create(client, owner, tracked=False)
    assert client.patch(f"{url_of(owner, row)}/edit", json={"track": track}).status_code == 422


def test_a_dated_edit_needs_the_layer_tracked(client, owner):
    row = create(client, owner, tracked=False)
    key = add_line(client, owner, row)
    answer = edit(client, owner, row, key, at="2026-10-12", geometry={"type": "LineString", "coordinates": MOVED})
    assert answer.status_code == 422
    assert "Track over time" in answer.json()["detail"]
    assert feature(client, owner, row, key)["geometry"]["coordinates"] == LINE


def test_moving_a_line_on_a_day_keeps_where_it_was_before(client, owner):
    row = create(client, owner)
    key = add_line(client, owner, row, date="2026-10-03")
    assert edit(client, owner, row, key, at="2026-10-12",
                geometry={"type": "LineString", "coordinates": MOVED}).status_code == 200
    stored = feature(client, owner, row, key)
    assert [state["at"] for state in stored["properties"]["states"]] == ["2026-10-03", "2026-10-12"]
    assert stored["properties"]["states"][0]["geometry"]["coordinates"] == LINE
    # everything that reads the layer without asking about time reads its latest shape
    assert stored["geometry"]["coordinates"] == MOVED
    assert stored["properties"]["date"] == "2026-10-03"
    drawn = client.get(f"{url_of(owner, row)}/data").json()["features"][0]
    assert drawn["geometry"]["coordinates"] == MOVED
    assert len(drawn["properties"]["states"]) == 2


def test_an_undated_line_moved_on_a_day_was_there_always_before_it(client, owner):
    row = create(client, owner)
    key = add_line(client, owner, row)
    edit(client, owner, row, key, at="2026-10-12", geometry={"type": "LineString", "coordinates": MOVED})
    states = feature(client, owner, row, key)["properties"]["states"]
    assert [state["at"] for state in states] == ["", "2026-10-12"]
    assert "date" not in feature(client, owner, row, key)["properties"]


def test_an_edit_with_no_date_is_refused_on_a_feature_moved_by_date(client, owner):
    row = create(client, owner)
    key = add_line(client, owner, row, date="2026-10-03", name="Front")
    edit(client, owner, row, key, at="2026-10-12", geometry={"type": "LineString", "coordinates": MOVED})
    before = feature(client, owner, row, key)
    answer = edit(client, owner, row, key, geometry={"type": "LineString", "coordinates": FURTHER})
    assert answer.status_code == 422
    assert answer.json()["detail"] == "“Front” moves on 12 Oct 2026: pick a day on the bar to move it"
    assert feature(client, owner, row, key) == before


def test_an_edit_with_no_date_moves_a_feature_on_every_day_when_only_its_status_changed(client, owner):
    row = create(client, owner)
    key = add_line(client, owner, row, date="2026-10-03")
    edit(client, owner, row, key, at="2026-10-12", status="damaged")
    edit(client, owner, row, key, end="2026-10-20")
    moved = edit(client, owner, row, key, geometry={"type": "LineString", "coordinates": FURTHER}).json()["marker"]
    states = moved["properties"]["states"]
    assert [state.get("geometry", {}).get("coordinates") for state in states] == [FURTHER, FURTHER, None]
    assert moved["geometry"]["coordinates"] == FURTHER
    # its status changed on a date, so with no date it is not set
    refused = edit(client, owner, row, key, status="destroyed")
    assert refused.status_code == 422 and "changes status on 12 Oct 2026" in refused.json()["detail"]


def test_a_state_written_twice_on_one_moment_is_rewritten_not_doubled(client, owner):
    row = create(client, owner)
    key = add_line(client, owner, row, date="2026-10-03")
    for coordinates in (MOVED, FURTHER):
        edit(client, owner, row, key, at="2026-10-12", geometry={"type": "LineString", "coordinates": coordinates})
    states = feature(client, owner, row, key)["properties"]["states"]
    assert len(states) == 2 and states[1]["geometry"]["coordinates"] == FURTHER


def test_a_state_between_two_starts_from_the_one_before_it(client, owner):
    row = create(client, owner)
    key = add_line(client, owner, row, date="2026-10-03")
    edit(client, owner, row, key, at="2026-10-20", geometry={"type": "LineString", "coordinates": FURTHER})
    edit(client, owner, row, key, at="2026-10-12", status="damaged")
    states = feature(client, owner, row, key)["properties"]["states"]
    assert [state["at"] for state in states] == ["2026-10-03", "2026-10-12", "2026-10-20"]
    assert states[1]["geometry"]["coordinates"] == LINE
    assert states[1]["status"] == "damaged"
    assert "status" not in states[2]


def test_a_status_on_a_day_keeps_the_shape_and_mirrors_the_latest(client, owner):
    row = create(client, owner)
    answer = client.post(f"{url_of(owner, row)}/markers", json={"lat": 50, "lon": 30, "date": "2026-10-01"})
    key = answer.json()["marker"]["properties"]["key"]
    marked = edit(client, owner, row, key, at="2026-10-15", status="destroyed").json()["marker"]
    assert marked["properties"]["status"] == "destroyed"
    states = marked["properties"]["states"]
    assert [state.get("status") for state in states] == [None, "destroyed"]
    assert states[1]["geometry"] == states[0]["geometry"]


def test_gone_from_a_day_then_taken_back(client, owner):
    row = create(client, owner)
    key = add_line(client, owner, row, date="2026-10-03")
    gone = edit(client, owner, row, key, end="2026-10-20").json()["marker"]["properties"]
    assert gone["states"][-1] == {"at": "2026-10-20", "gone": True}
    assert gone["date_end"] == "2026-10-20"
    back = edit(client, owner, row, key, at="2026-10-20", drop_state=True).json()["marker"]["properties"]
    # one state dated to a day is a plain feature again
    assert "states" not in back and back["date"] == "2026-10-03" and "date_end" not in back


def test_an_end_moved_replaces_the_old_one_and_still_there_takes_it_away(client, owner):
    row = create(client, owner)
    key = add_line(client, owner, row, date="2026-10-03")
    edit(client, owner, row, key, at="2026-10-12", geometry={"type": "LineString", "coordinates": MOVED})
    edit(client, owner, row, key, end="2026-10-20")
    moved = edit(client, owner, row, key, end="2026-10-25").json()["marker"]["properties"]
    assert [state["at"] for state in moved["states"]] == ["2026-10-03", "2026-10-12", "2026-10-25"]
    assert moved["date_end"] == "2026-10-25"
    kept = edit(client, owner, row, key, end="").json()["marker"]["properties"]
    assert [state["at"] for state in kept["states"]] == ["2026-10-03", "2026-10-12"]
    assert "date_end" not in kept


def test_a_plain_last_day_is_taken_away_by_still_there():
    # a last day brought in by a proof or a file is a plain bound, not a state
    plain = {"type": "Feature", "geometry": {"type": "LineString", "coordinates": LINE},
             "properties": {"date": "2026-10-03", "date_end": "2026-10-09"}}
    layerediting.set_end(plain, "")
    assert plain["properties"] == {"date": "2026-10-03"}


@pytest.mark.parametrize(("start", "said"), [("2026-10-08", {"date": "2026-10-08"}), ("", {})])
def test_a_plain_feature_starts_on_a_day_or_always(client, owner, start, said):
    row = create(client, owner)
    key = add_line(client, owner, row, date="2026-10-03")
    properties = edit(client, owner, row, key, start=start).json()["marker"]["properties"]
    assert "states" not in properties
    assert {field: properties[field] for field in ("date",) if field in properties} == said


def test_a_start_moves_the_first_state_and_stays_before_the_next(client, owner):
    row = create(client, owner)
    key = add_line(client, owner, row, date="2026-10-03")
    edit(client, owner, row, key, at="2026-10-12", geometry={"type": "LineString", "coordinates": MOVED})
    always = edit(client, owner, row, key, start="").json()["marker"]["properties"]
    assert [state["at"] for state in always["states"]] == ["", "2026-10-12"] and "date" not in always
    later = edit(client, owner, row, key, start="2026-10-10").json()["marker"]["properties"]
    assert [state["at"] for state in later["states"]] == ["2026-10-10", "2026-10-12"]
    refused = edit(client, owner, row, key, start="2026-10-12")
    assert refused.status_code == 422 and refused.json()["detail"] == "start it before 12 Oct 2026"


def test_an_end_comes_after_the_last_change(client, owner):
    row = create(client, owner)
    key = add_line(client, owner, row, date="2026-10-03")
    edit(client, owner, row, key, at="2026-10-12", geometry={"type": "LineString", "coordinates": MOVED})
    refused = edit(client, owner, row, key, end="2026-10-12")
    assert refused.status_code == 422 and refused.json()["detail"] == "end it after 12 Oct 2026"


def test_a_start_at_a_time_gives_a_plain_feature_a_history_that_keeps_its_last_day():
    plain = {"type": "Feature", "geometry": {"type": "LineString", "coordinates": LINE},
             "properties": {"date": "2026-10-03", "date_end": "2026-10-09"}}
    layerediting.set_start(plain, "2026-10-04T08:00")
    states = plain["properties"]["states"]
    # the last day it showed becomes gone the day after, so it still leaves on time
    assert [(state["at"], bool(state.get("gone"))) for state in states] == [("2026-10-04T08:00", False), ("2026-10-10", True)]
    assert plain["properties"]["date"] == "2026-10-04" and plain["properties"]["date_end"] == "2026-10-10"


def test_when_it_shows_needs_the_layer_tracked(client, owner):
    row = create(client, owner, tracked=False)
    key = add_line(client, owner, row, date="2026-10-03")
    for changes in ({"start": ""}, {"end": "2026-10-09"}):
        answer = edit(client, owner, row, key, **changes)
        assert answer.status_code == 422 and "Track over time" in answer.json()["detail"]


def test_a_selection_takes_one_start_and_one_end_together(client, owner):
    row = create(client, owner)
    keys = [add_line(client, owner, row, date="2026-09-28"), add_line(client, owner, row, MOVED, date="2026-09-28")]
    started = client.post(f"{url_of(owner, row)}/selection", json={"keys": keys, "changes": {"start": "2026-09-30"}})
    assert started.status_code == 200, started.text
    ended = client.post(f"{url_of(owner, row)}/selection", json={"keys": keys, "changes": {"end": "2026-10-05"}})
    assert ended.status_code == 200, ended.text
    for key in keys:
        properties = feature(client, owner, row, key)["properties"]
        assert properties["date"] == "2026-09-30"
        assert properties["states"][-1] == {"at": "2026-10-05", "gone": True}


def test_a_selection_start_one_feature_cannot_take_changes_none(client, owner):
    row = create(client, owner)
    plain = add_line(client, owner, row, date="2026-10-03")
    moved = add_line(client, owner, row, FURTHER, date="2026-10-03")
    edit(client, owner, row, moved, at="2026-10-12", geometry={"type": "LineString", "coordinates": MOVED})
    before = [feature(client, owner, row, key) for key in (plain, moved)]
    refused = client.post(f"{url_of(owner, row)}/selection", json={"keys": [plain, moved], "changes": {"start": "2026-10-15"}})
    assert refused.status_code == 422 and refused.json()["detail"] == "start it before 12 Oct 2026"
    assert [feature(client, owner, row, key) for key in (plain, moved)] == before


def test_an_unknown_end_leaves_no_end_and_a_day_or_still_there_takes_it_back(client, owner):
    row = create(client, owner)
    key = add_line(client, owner, row, date="2026-10-03")
    edit(client, owner, row, key, end="2026-10-09")
    unknown = edit(client, owner, row, key, end_unknown=True).json()["marker"]["properties"]
    assert unknown["end_unknown"] is True
    assert "date_end" not in unknown and not any(state.get("gone") for state in unknown.get("states", []))
    # drawn as one still there: it stands on any day after its first
    assert layerediting.as_of(feature(client, owner, row, key), "2027-01-01") is not None
    ended = edit(client, owner, row, key, end="2026-10-12").json()["marker"]["properties"]
    assert "end_unknown" not in ended
    edit(client, owner, row, key, end_unknown=True)
    assert "end_unknown" not in edit(client, owner, row, key, end="").json()["marker"]["properties"]


def test_a_selection_takes_an_unknown_end_together(client, owner):
    row = create(client, owner)
    keys = [add_line(client, owner, row, date="2026-10-03"), add_line(client, owner, row, MOVED, date="2026-10-03")]
    client.post(f"{url_of(owner, row)}/selection", json={"keys": keys, "changes": {"end": "2026-10-05"}})
    answer = client.post(f"{url_of(owner, row)}/selection", json={"keys": keys, "changes": {"end_unknown": True}})
    assert answer.status_code == 200, answer.text
    for key in keys:
        properties = feature(client, owner, row, key)["properties"]
        assert properties["end_unknown"] is True and "date_end" not in properties


def test_an_unknown_end_is_never_set_by_false_or_off_a_tracked_layer(client, owner):
    row = create(client, owner)
    key = add_line(client, owner, row, date="2026-10-03")
    assert edit(client, owner, row, key, end_unknown=False).status_code == 422
    plain = create(client, owner, tracked=False)
    other = add_line(client, owner, plain, date="2026-10-03")
    refused = edit(client, owner, plain, other, end_unknown=True)
    assert refused.status_code == 422 and "Track over time" in refused.json()["detail"]


def test_a_selection_says_when_it_shows_only_on_a_tracked_layer(client, owner):
    row = create(client, owner, tracked=False)
    keys = [add_line(client, owner, row, date="2026-10-03")]
    answer = client.post(f"{url_of(owner, row)}/selection", json={"keys": keys, "changes": {"end": "2026-10-09"}})
    assert answer.status_code == 422 and "Track over time" in answer.json()["detail"]


@pytest.mark.parametrize("changes", [
    {"end": "2026-10-03"},
    {"end": "2026-10-01"},
    {"start": "2026-10-20"},
    {"at": "2026-10-05", "drop_state": True},
    {"at": "2026-13-40", "status": "damaged"},
    {"at": "12/10/2026", "status": "damaged"},
])
def test_a_history_that_would_not_hold_is_refused(client, owner, changes):
    row = create(client, owner)
    key = add_line(client, owner, row, date="2026-10-03")
    edit(client, owner, row, key, at="2026-10-12", geometry={"type": "LineString", "coordinates": MOVED})
    before = feature(client, owner, row, key)
    assert edit(client, owner, row, key, **changes).status_code == 422
    assert feature(client, owner, row, key) == before


def test_times_sort_after_their_day_on_a_layer_dated_to_the_minute(client, owner):
    row = create(client, owner, precision="time", zone="Europe/Kyiv")
    key = add_line(client, owner, row, at="2026-10-12T14:00")
    edit(client, owner, row, key, at="2026-10-12T09:30", geometry={"type": "LineString", "coordinates": MOVED})
    edit(client, owner, row, key, at="2026-10-12", geometry={"type": "LineString", "coordinates": FURTHER})
    states = feature(client, owner, row, key)["properties"]["states"]
    assert [state["at"] for state in states] == ["2026-10-12", "2026-10-12T09:30", "2026-10-12T14:00"]


def test_a_feature_added_while_the_layer_is_read_at_a_moment_appears_then(client, owner):
    row = create(client, owner)
    answer = client.post(f"{url_of(owner, row)}/markers", json={"lat": 50, "lon": 30, "at": "2026-10-12"})
    properties = answer.json()["marker"]["properties"]
    assert properties["states"][0]["at"] == "2026-10-12" and properties["date"] == "2026-10-12"


def test_a_selection_moved_on_a_day_is_one_undo(client, owner):
    row = create(client, owner)
    keys = [add_line(client, owner, row, date="2026-10-03"), add_line(client, owner, row, MOVED, date="2026-10-03")]
    moved = client.post(f"{url_of(owner, row)}/selection", json={"keys": keys, "offset": [0, 0.5], "at": "2026-10-12"})
    assert moved.status_code == 200, moved.text
    first = feature(client, owner, row, keys[0])
    assert first["properties"]["states"][0]["geometry"]["coordinates"] == LINE
    assert first["geometry"]["coordinates"] == [[30.0, 50.5], [30.1, 50.5]]
    assert client.post(f"{url_of(owner, row)}/selection/{moved.json()['batch']}/restore").status_code == 200
    back = feature(client, owner, row, keys[0])
    assert "states" not in back["properties"] and back["geometry"]["coordinates"] == LINE


def test_merging_or_splitting_a_feature_with_a_history_is_refused(client, owner):
    row = create(client, owner)
    keys = [add_line(client, owner, row, date="2026-10-03"), add_line(client, owner, row, [[30.1, 50.0], [30.2, 50.0]])]
    edit(client, owner, row, keys[0], at="2026-10-12", geometry={"type": "LineString", "coordinates": MOVED})
    merged = client.post(f"{url_of(owner, row)}/merge", json={"keys": keys})
    assert merged.status_code == 422 and "history" in merged.json()["detail"]
    assert client.post(f"{url_of(owner, row)}/split", json={"key": keys[0], "at": 1}).status_code == 422


def test_switching_off_keeps_the_history_and_edits_then_correct_the_latest(client, owner):
    row = create(client, owner)
    key = add_line(client, owner, row, date="2026-10-03")
    edit(client, owner, row, key, at="2026-10-12", geometry={"type": "LineString", "coordinates": MOVED})
    client.patch(f"{url_of(owner, row)}/edit", json={"track": {"on": False}})
    edit(client, owner, row, key, geometry={"type": "LineString", "coordinates": FURTHER})
    states = feature(client, owner, row, key)["properties"]["states"]
    assert [state["geometry"]["coordinates"] for state in states] == [LINE, FURTHER]


def test_discarding_the_session_puts_the_switch_back(client, owner):
    row = create(client, owner, tracked=False)
    session = client.post(f"{url_of(owner, row)}/edit", json={}).json()
    client.patch(f"{url_of(owner, row)}/edit", json={"track": {"on": True}})
    revision = client.get(f"{url_of(owner, row)}/edit").json()["layer"]["edit_revision"]
    closed = client.post(f"{url_of(owner, row)}/edit/finish",
                         json={"token": session["checkpoint"], "revision": revision, "discard": True})
    assert closed.status_code == 200, closed.text
    assert closed.json()["layer"]["track"] is None


def _export(client, owner, row, fmt, **body):
    answer = client.post(f"{url_of(owner, row)}/export/{fmt}", json={"icons": {}, **body})
    assert answer.status_code == 200, answer.text
    return answer.content


def test_the_layer_as_it_stood_on_a_day_is_what_a_my_maps_is_sent(client, owner):
    row = create(client, owner)
    front = add_line(client, owner, row, date="2026-10-03")
    edit(client, owner, row, front, at="2026-10-12", geometry={"type": "LineString", "coordinates": MOVED})
    later = add_line(client, owner, row, FURTHER, date="2026-10-15")
    gone = add_line(client, owner, row, [[31, 50], [31.1, 50]], date="2026-10-01")
    edit(client, owner, row, gone, end="2026-10-05")
    always = add_line(client, owner, row, [[32, 50], [32.1, 50]])
    document = json.loads(_export(client, owner, row, "geojson", at="2026-10-10"))
    by_name = {f["properties"]["name"]: f for f in document["features"]}
    names = {key: feature(client, owner, row, key)["properties"]["name"] for key in (front, later, gone, always)}
    assert set(by_name) == {names[front], names[always]}
    assert by_name[names[front]]["geometry"]["coordinates"] == LINE
    assert all("states" not in f["properties"] for f in document["features"])


def test_the_whole_history_goes_out_as_dated_spans(client, owner):
    row = create(client, owner, precision="time", zone="Europe/Kyiv")
    key = add_line(client, owner, row, at="2026-10-03")
    edit(client, owner, row, key, at="2026-10-12T14:00", geometry={"type": "LineString", "coordinates": MOVED})
    edit(client, owner, row, key, end="2026-10-20")
    root = ET.fromstring(_export(client, owner, row, "kml", history=True))
    spans = [(span.findtext("k:begin", namespaces=NS), span.findtext("k:end", namespaces=NS))
             for span in root.iterfind(".//k:Placemark/k:TimeSpan", NS)]
    assert spans == [("2026-10-03T00:00:00+03:00", "2026-10-12T14:00:00+03:00"),
                     ("2026-10-12T14:00:00+03:00", "2026-10-20T00:00:00+03:00")]
    with zipfile.ZipFile(io.BytesIO(_export(client, owner, row, "kmz", history=True))) as archive:
        assert archive.read("doc.kml").count(b"<TimeSpan>") == 2


def test_a_my_maps_address_is_kept_and_anything_else_refused(client, owner):
    row = create(client, owner, tracked=False)
    address = "https://www.google.com/maps/d/edit?mid=1AbC"
    kept = client.patch(f"{url_of(owner, row)}/edit", json={"mymaps": address})
    assert kept.json()["layer"]["mymaps"] == address
    assert client.patch(f"{url_of(owner, row)}/edit", json={"mymaps": "https://evil.example/maps/d/x"}).status_code == 422
    assert client.patch(f"{url_of(owner, row)}/edit", json={"mymaps": ""}).json()["layer"]["mymaps"] == ""


def test_a_selection_moved_with_no_date_moves_on_every_day_or_not_at_all(client, owner):
    row = create(client, owner)
    steady = add_line(client, owner, row, date="2026-10-03")
    edit(client, owner, row, steady, at="2026-10-12", status="damaged")
    plain = add_line(client, owner, row, FURTHER)
    answer = client.post(f"{url_of(owner, row)}/selection", json={"keys": [steady, plain], "offset": [0, 1]})
    assert answer.status_code == 200, answer.text
    states = feature(client, owner, row, steady)["properties"]["states"]
    assert [state["geometry"]["coordinates"] for state in states] == [[[30.0, 51.0], [30.1, 51.0]]] * 2
    rewritten = feature(client, owner, row, plain)
    assert "states" not in rewritten["properties"]
    assert rewritten["geometry"]["coordinates"] == [[30.0, 51.2], [30.1, 51.2]]
    # one feature moved by date holds the whole selection back, as one edit refused
    edit(client, owner, row, steady, at="2026-10-15", geometry={"type": "LineString", "coordinates": MOVED})
    before = [feature(client, owner, row, key) for key in (steady, plain)]
    answer = client.post(f"{url_of(owner, row)}/selection", json={"keys": [steady, plain], "offset": [0, 1]})
    assert answer.status_code == 422 and "moves on 15 Oct 2026" in answer.json()["detail"]
    assert [feature(client, owner, row, key) for key in (steady, plain)] == before


def test_a_group_of_events_marks_its_features_for_the_map(client, owner):
    row = create(client, owner)
    groups = client.get(f"{url_of(owner, row)}/edit").json()["groups"]
    answer = client.patch(f"{url_of(owner, row)}/groups/{groups[0]['id']}", json={"events": True})
    assert answer.status_code == 200, answer.text
    assert answer.json()["groups"][0]["events"] is True
    client.post(f"{url_of(owner, row)}/markers", json={"lat": 50, "lon": 30, "date": "2026-10-12"})
    drawn = client.get(f"{url_of(owner, row)}/data").json()["features"][0]["properties"]
    assert drawn["event"] is True
    off = client.patch(f"{url_of(owner, row)}/groups/{groups[0]['id']}", json={"events": False})
    assert "events" not in off.json()["groups"][0]
