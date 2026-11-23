"""Leads, and what the pill of the scene being geolocated lists and lets go of.

A lead is a spot dropped on a map while a scene is geolocated: kept on the scene like
its captures, numbered, erased when the scene is abandoned or a proof takes it up. The
pill lists what the scene gathered (leads, captures, frames, collages) and lets a
capture go to the Trash and a frame off Inspect's strip. From the extension, the same
routes reach the scene being geolocated and nothing else.
"""

from __future__ import annotations

import graph_read
import pytest
from test_geolocate import (
    PLACE,
    SCENES,
    _capture,
    _case,
    _collage,
    _geolocate,
    _mark,
    _queue,
    _save_work,
    _stored,
    _upload,
    _video,
    needs_ffmpeg,
)

from azimut.engine import inspectwork


def _drop(client, cid, lat=48.85, lon=2.29):
    return client.post(f"/api/cases/{cid}/geolocating/leads", json={"lat": lat, "lon": lon})


def _held(client, cid):
    return client.get(f"/api/cases/{cid}/geolocating").json()["geolocating"]


def _ext(client):
    return {"X-Azimut-Token": client.post("/api/settings/ingest-token").json()["ingest_token"]}


# -- dropping, moving, deleting ------------------------------------------------------


def test_a_lead_is_dropped_numbered_moved_and_deleted_on_the_scene_being_geolocated(client):
    cid = _case(client)
    photo = _upload(client, cid)
    _save_work(client, cid, photo, SCENES)

    # nothing is being geolocated: a lead has no scene to belong to
    assert _drop(client, cid).status_code == 409

    _geolocate(client, cid, photo, "s1")
    first = _drop(client, cid, 48.1, 2.1)
    assert first.status_code == 200, first.text
    one = first.json()["lead"]
    assert (one["n"], one["lat"], one["lon"]) == (1, 48.1, 2.1)
    assert first.json()["geolocating"]["leads"] == [one]
    two = _drop(client, cid, 48.2, 2.2).json()["lead"]
    assert two["n"] == 2

    # kept on the scene in its file's work, beside its captures, never as a case place
    stored = next(s for s in _stored(client, cid, photo) if s["id"] == "s1")
    assert [p["id"] for p in stored["leads"]] == [one["id"], two["id"]]
    assert not [e for e in graph_read.entities(cid) if e["type"] == "place"]

    moved = client.patch(f"/api/cases/{cid}/geolocating/leads/{one['id']}", json={"lat": 47.0, "lon": 3.0})
    assert moved.status_code == 200, moved.text
    assert moved.json()["lead"] == {**one, "lat": 47.0, "lon": 3.0}

    # deleting one leaves the other its number, and the next one numbers on
    assert client.delete(f"/api/cases/{cid}/geolocating/leads/{one['id']}").status_code == 200
    assert [p["n"] for p in _held(client, cid)["leads"]] == [2]
    assert _drop(client, cid).json()["lead"]["n"] == 3
    assert client.delete(f"/api/cases/{cid}/geolocating/leads/{one['id']}").status_code == 409


def test_a_lead_is_checked_at_the_edge(client):
    cid = _case(client)
    photo = _upload(client, cid)
    _save_work(client, cid, photo, SCENES)
    _geolocate(client, cid, photo, "s1")
    assert _drop(client, cid, lat=91).status_code == 422
    assert _drop(client, cid, lon=-181).status_code == 422
    assert client.post(f"/api/cases/{cid}/geolocating/leads", json={"lat": "x", "lon": 2}).status_code == 422


def test_a_scene_keeps_at_most_so_many_leads(client, monkeypatch):
    monkeypatch.setattr(inspectwork, "MAX_LEADS", 2)
    cid = _case(client)
    photo = _upload(client, cid)
    _save_work(client, cid, photo, SCENES)
    _geolocate(client, cid, photo, "s1")
    assert _drop(client, cid).status_code == 200
    assert _drop(client, cid).status_code == 200
    refused = _drop(client, cid)
    assert refused.status_code == 409 and "at most 2" in refused.json()["detail"]


def test_inspect_saving_its_scenes_keeps_their_leads(client):
    cid = _case(client)
    photo = _upload(client, cid)
    _save_work(client, cid, photo, SCENES)
    _geolocate(client, cid, photo, "s1")
    lead = _drop(client, cid).json()["lead"]
    # Inspect sends its scenes as it holds them, without what the server keeps on them
    _save_work(client, cid, photo, [{**SCENES[0], "label": "Renamed"}, SCENES[1]])
    held = _held(client, cid)
    assert held["label"] == "Renamed" and held["leads"] == [lead]


def test_leads_ride_with_the_queue_only_where_a_scene_has_some(client):
    cid = _case(client)
    photo = _upload(client, cid)
    _save_work(client, cid, photo, SCENES)
    _geolocate(client, cid, photo, "s1")
    lead = _drop(client, cid).json()["lead"]
    rows = {s["id"]: s for s in _queue(client, cid)["files"][0]["scenes"]}
    assert rows["s1"]["leads"] == [lead]
    assert "leads" not in rows["s2"]


# -- what goes with the scene ------------------------------------------------------------


def test_abandoning_a_scene_erases_its_leads_and_taking_it_up_again_starts_without(client):
    cid = _case(client)
    photo = _upload(client, cid)
    _save_work(client, cid, photo, SCENES)
    _geolocate(client, cid, photo, "s1")
    _drop(client, cid)
    shot = _capture(client, cid)

    client.put(f"/api/cases/{cid}/scenes/s1/abandon", json={"video": photo, "reason": "nothing"})
    stored = next(s for s in _stored(client, cid, photo) if s["id"] == "s1")
    assert "leads" not in stored and stored["captures"] == [shot["path"]]

    client.delete(f"/api/cases/{cid}/scenes/s1/abandon", params={"video": photo})
    _geolocate(client, cid, photo, "s1")
    assert "leads" not in _held(client, cid)


@needs_ffmpeg
def test_a_proof_taking_a_video_scene_up_erases_its_leads(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    _save_work(client, cid, video, [{"id": "s1", "start": 1, "end": 2, "label": "Bridge"}])
    _geolocate(client, cid, video, "s1")
    _drop(client, cid)
    # stopped before the proof: the leads stay on the scene until it is proved
    client.delete(f"/api/cases/{cid}/geolocating")
    assert "leads" in _stored(client, cid, video)[0]

    shot = _capture(client, cid)
    cut = client.post(f"/api/cases/{cid}/inspect/save-frames", json={"items": [{"path": video, "time": 1.5}]})
    frame = cut.json()["saved"][0]["item"]["path"]
    made = client.post(f"/api/cases/{cid}/proofs", json={"title": "Bridge", "spec": {"panels": [
        {"id": "p0", "src": frame}, {"id": "p1", "src": shot["path"]},
    ], "coordsText": PLACE}})
    name = made.json()["name"]
    res = client.put(f"/api/cases/{cid}/proofs/{name}/scene", json={"moments": [{"start": 1, "end": 2}], "video": video, "draft": "s1"})
    assert res.status_code == 200, res.text
    assert "leads" not in _stored(client, cid, video)[0]


@needs_ffmpeg
def test_a_proof_laying_a_picture_out_erases_its_leads(client):
    cid = _case(client)
    photo = _upload(client, cid)
    scene = _mark(client, cid, photo).json()["scene"]
    _geolocate(client, cid, photo, scene["id"])
    _drop(client, cid)
    shot = _capture(client, cid)
    made = client.post(f"/api/cases/{cid}/proofs", json={"title": "Market", "spec": {"panels": [
        {"id": "p0", "src": photo}, {"id": "p1", "src": shot["path"]},
    ], "coordsText": PLACE}})
    assert made.status_code == 200, made.text
    assert "leads" not in _stored(client, cid, photo)[0]


def test_two_scenes_joined_keep_both_leads_numbered_on_and_an_undo_gives_them_back(client):
    cid = _case(client)
    photo = _upload(client, cid)
    _save_work(client, cid, photo, [
        {"id": "a", "start": 1, "end": 2, "label": "A"},
        {"id": "b", "start": 5, "end": 6, "label": "B"},
    ])
    _geolocate(client, cid, photo, "a")
    a1 = _drop(client, cid, 1, 1).json()["lead"]
    _geolocate(client, cid, photo, "b")
    b1 = _drop(client, cid, 2, 2).json()["lead"]

    joined = client.post(f"/api/cases/{cid}/scenes/b/join", json={"video": photo, "into": "a"})
    assert joined.status_code == 200, joined.text
    stored = next(s for s in _stored(client, cid, photo) if s["id"] == "a")
    assert [(p["id"], p["n"]) for p in stored["leads"]] == [(a1["id"], 1), (b1["id"], 2)]

    # one dropped on the joined scene since stays with it through the Undo
    since = _drop(client, cid, 3, 3).json()["lead"]
    undo = joined.json()["undo"]
    back = client.post(f"/api/cases/{cid}/scenes/a/unjoin", json={"video": photo, **undo})
    assert back.status_code == 200, back.text
    rows = {s["id"]: s for s in _stored(client, cid, photo)}
    assert [p["id"] for p in rows["a"]["leads"]] == [a1["id"], since["id"]]
    assert [p["id"] for p in rows["b"]["leads"]] == [b1["id"]]


def test_clean_leads_keeps_only_well_formed_points():
    kept = inspectwork.clean_leads([
        {"id": "p1", "n": 1, "lat": 10, "lon": 20},
        {"id": "p1", "n": 2, "lat": 10, "lon": 20},  # the same id twice
        {"id": "p2", "n": 0, "lat": 10, "lon": 20},
        {"id": "p3", "n": True, "lat": 10, "lon": 20},
        {"id": "p4", "n": 3, "lat": 95, "lon": 20},
        {"id": "p5", "n": 4, "lat": float("nan"), "lon": 20},
        {"id": "", "n": 5, "lat": 1, "lon": 1},
        "p6",
    ])
    assert kept == [{"id": "p1", "n": 1, "lat": 10.0, "lon": 20.0}]
    assert inspectwork.clean_leads(None) == []


# -- the pill's list ---------------------------------------------------------------------


@needs_ffmpeg
def test_the_pill_lists_what_the_scene_gathered_and_only_what_falls_in_it(client, tmp_path):
    cid = _case(client)
    assert client.get(f"/api/cases/{cid}/geolocating/gathered").json() == {"geolocating": None}
    video = _video(client, cid, tmp_path)
    cut = client.post(f"/api/cases/{cid}/inspect/save-frames", json={"items": [{"path": video, "time": 1.5}]})
    filed = cut.json()["saved"][0]["item"]["path"]
    frames = [
        {"id": "in", "path": video, "time": 1.5, "filed": {"path": filed}},
        {"id": "loose", "path": video, "time": 1.8, "rotation": 90},
        {"id": "out", "path": video, "time": 3.5},
    ]
    res = client.put(f"/api/cases/{cid}/inspect/work", json={"path": video, "spec": {"frames": frames, "scenes": [
        {"id": "pass", "start": 1.0, "end": 2.0, "label": "Bridge"},
    ]}})
    assert res.status_code == 200, res.text
    _collage(client, cid, "Quay", [(video, 1.5), (video, 1.7)])
    _collage(client, cid, "Far", [(video, 3.5), (video, 3.6)])
    _geolocate(client, cid, video, "pass")
    shot = _capture(client, cid)
    lead = _drop(client, cid).json()["lead"]

    got = client.get(f"/api/cases/{cid}/geolocating/gathered").json()
    assert got["geolocating"]["id"] == "pass"
    assert got["leads"] == [lead]
    assert [c["path"] for c in got["captures"]] == [shot["path"]]
    assert got["captures"][0]["thumb"]
    assert [(f["id"], f["path"]) for f in got["frames"]] == [("in", filed), ("loose", None)]
    # a frame never saved comes with Inspect's edits, for the list to draw it as Inspect would save it
    assert got["frames"][1]["edits"] == {"rotation": 90}
    assert [c["title"] for c in got["collages"]] == ["Quay"]
    assert "picture" not in got
    # the list says as many as the counts on the pill
    assert len(got["frames"]) + len(got["collages"]) == got["geolocating"]["footage"]


def test_a_picture_s_pill_lists_the_picture_and_no_frames(client):
    cid = _case(client)
    photo = _upload(client, cid)
    scene = _mark(client, cid, photo).json()["scene"]
    _geolocate(client, cid, photo, scene["id"])
    got = client.get(f"/api/cases/{cid}/geolocating/gathered").json()
    assert got["frames"] == [] and got["collages"] == []
    assert got["picture"]["path"] == photo


@needs_ffmpeg
def test_a_frame_leaves_the_strip_from_the_pill_and_only_one_of_the_scene(client, tmp_path, monkeypatch):
    from azimut.api import events

    cid = _case(client)
    video = _video(client, cid, tmp_path)
    frames = [{"id": "in", "path": video, "time": 1.5}, {"id": "out", "path": video, "time": 3.5}]
    client.put(f"/api/cases/{cid}/inspect/work", json={"path": video, "spec": {
        "frames": frames, "scenes": [{"id": "pass", "start": 1.0, "end": 2.0, "label": ""}], "activeFrameId": "in",
    }})
    _geolocate(client, cid, video, "pass")
    assert _held(client, cid)["footage"] == 1

    # a frame outside the scene is not the pill's to take
    assert client.delete(f"/api/cases/{cid}/geolocating/frames/out").status_code == 409

    heard: list[dict] = []
    monkeypatch.setattr(events, "publish", heard.append)
    res = client.delete(f"/api/cases/{cid}/geolocating/frames/in")
    assert res.status_code == 200, res.text
    assert res.json()["geolocating"]["footage"] == 0
    work = client.get(f"/api/cases/{cid}/inspect/work", params={"path": video}).json()["work"]["spec"]
    assert [f["id"] for f in work["frames"]] == ["out"]
    assert work["activeFrameId"] is None
    # an Inspect open on that video hears which frame left its strip
    assert {"type": "scenes", "case_id": cid, "video": video, "frame_removed": "in"} in heard


def test_a_capture_deleted_from_the_pill_goes_to_the_trash(client):
    cid = _case(client)
    photo = _upload(client, cid)
    _save_work(client, cid, photo, SCENES)
    _geolocate(client, cid, photo, "s1")
    shot = _capture(client, cid)
    res = client.delete(f"/api/cases/{cid}/satellite", params={"path": shot["path"]})
    assert res.status_code == 200, res.text
    assert _held(client, cid)["captures"] == []
    assert client.get(f"/api/cases/{cid}/geolocating/gathered").json()["captures"] == []


# -- from the extension ------------------------------------------------------------------


def test_the_extension_drops_moves_and_deletes_leads_with_the_token(client):
    cid = _case(client)
    photo = _upload(client, cid)
    _save_work(client, cid, photo, SCENES)
    _geolocate(client, cid, photo, "s1")
    assert client.post("/api/ingest/leads", json={"case_id": cid, "lat": 1, "lon": 2}).status_code == 401
    headers = _ext(client)
    made = client.post("/api/ingest/leads", headers=headers, json={"case_id": cid, "lat": 1, "lon": 2})
    assert made.status_code == 200, made.text
    lead = made.json()["lead"]
    moved = client.post("/api/ingest/leads/move", headers=headers, json={"case_id": cid, "lead": lead["id"], "lat": 3, "lon": 4})
    assert moved.json()["lead"]["lat"] == 3
    gone = client.post("/api/ingest/leads/remove", headers=headers, json={"case_id": cid, "lead": lead["id"]})
    assert gone.status_code == 200 and "leads" not in gone.json()["geolocating"]


def test_the_extension_reaches_only_what_the_scene_gathered(client):
    cid = _case(client)
    photo = _upload(client, cid)
    other = _upload(client, cid, name="other.png", color=(10, 200, 10))
    _save_work(client, cid, photo, SCENES)
    _geolocate(client, cid, photo, "s1")
    shot = _capture(client, cid)
    headers = _ext(client)

    listed = client.get("/api/ingest/geolocating/gathered", headers=headers, params={"case_id": cid})
    assert [c["path"] for c in listed.json()["captures"]] == [shot["path"]]

    thumb = client.get("/api/ingest/geolocating/thumb", headers=headers, params={"case_id": cid, "path": shot["path"]})
    assert thumb.status_code == 200 and thumb.headers["content-type"].startswith("image/")
    # a file of the case the scene did not gather is refused, its thumbnail and its delete
    assert client.get("/api/ingest/geolocating/thumb", headers=headers, params={"case_id": cid, "path": other}).status_code == 403
    for route, body in (
        ("/api/ingest/geolocating/impact", {"case_id": cid, "path": other}),
        ("/api/ingest/geolocating/remove", {"case_id": cid, "kind": "capture", "target": other}),
    ):
        assert client.post(route, headers=headers, json=body).status_code == 409
    assert any(m["path"] == other for m in client.get(f"/api/cases/{cid}/media").json())

    impact = client.post("/api/ingest/geolocating/impact", headers=headers, json={"case_id": cid, "path": shot["path"]})
    assert impact.status_code == 200 and "counts" in impact.json()
    removed = client.post("/api/ingest/geolocating/remove", headers=headers, json={"case_id": cid, "kind": "capture", "target": shot["path"]})
    assert removed.status_code == 200, removed.text
    assert removed.json()["deleted"] and removed.json()["geolocating"]["captures"] == []


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "/api/ingest/geolocating/gathered"),
        ("get", "/api/ingest/geolocating/thumb"),
        ("post", "/api/ingest/geolocating/impact"),
        ("post", "/api/ingest/geolocating/remove"),
        ("post", "/api/ingest/leads/move"),
        ("post", "/api/ingest/leads/remove"),
    ],
)
def test_every_new_extension_route_needs_the_token(client, method, path):
    assert getattr(client, method)(path).status_code == 401


def test_a_bundle_carries_a_scene_s_leads_into_the_case_it_makes(client):
    from azimut.engine import bundles
    from azimut.workspace import Case

    cid = _case(client)
    photo = _upload(client, cid)
    _save_work(client, cid, photo, SCENES)
    _geolocate(client, cid, photo, "s1")
    lead = _drop(client, cid).json()["lead"]

    exported = bundles.export_case(Case.open(cid))
    destination = Case.create(bundles.imported_name("Leads"))
    made = bundles.import_into(destination, exported)["case_id"]
    stored = next(s for s in _stored(client, made, photo) if s["id"] == "s1")
    assert stored["leads"] == [lead]

