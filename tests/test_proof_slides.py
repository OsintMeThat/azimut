"""Geo Proof's list of proofs and its delete, as they read a video's slides.

The list says, for a proof resting on a video, which video and where it stands among
that video's proofs, so Open proof and Geo Proof's home can tag it ``clip.mp4 · 2/4``.
The delete of a proof of a scene can give its scene back to geolocate, as it always
did, or take it along.
"""

from __future__ import annotations

import time

import pytest
from scenesfixture import _case, _cut, _proof, _save_work, _scenes, _upload_png, _video, _work, needs_ffmpeg

from azimut import layout
from azimut.engine import scenes as scenes_engine
from azimut.workspace import Case


def _listed(client, cid):
    res = client.get(f"/api/cases/{cid}/proofs")
    assert res.status_code == 200, res.text
    return {row["name"]: row for row in res.json()}


def _drafts(client, cid, video):
    return [s for s in _scenes(client, cid, video)["scenes"] if s["kind"] == "draft"]


# -- the list says where a proof stands among its video's slides --------------------------


@needs_ffmpeg
def test_the_list_numbers_a_videos_proofs_in_clip_order_the_abandoned_last(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    photo = _upload_png(client, cid)
    _save_work(client, cid, video, scenes=[{"id": "s1", "start": 1.0, "end": 1.5, "label": "Mast?"}])
    for title, at in (("Square", 3.0), ("Bridge", 0.5), ("Market", 2.0)):
        _proof(client, cid, title, photo, scene={"video": video, "moments": [{"start": at}]})
    _proof(client, cid, "Holiday", photo)
    # Bridge states no place: given up on, it goes to the end
    assert client.put(f"/api/cases/{cid}/proofs/Bridge/abandon", json={"reason": "blurry"}).status_code == 200

    rows = _listed(client, cid)

    assert rows["Holiday"]["video"] is None
    assert "slide" not in rows["Holiday"]
    assert {name: (rows[name]["video"], rows[name]["slide"], rows[name]["slides"]) for name in ("Market", "Square", "Bridge")} == {
        "Market": (video, 1, 3), "Square": (video, 2, 3), "Bridge": (video, 3, 3),
    }
    # the colour is the place among the video's scenes, the draft between them included
    assert [rows[name]["order"] for name in ("Bridge", "Market", "Square")] == [0, 2, 3]


@needs_ffmpeg
def test_the_list_says_which_slides_a_video_thread_posts(client, tmp_path):
    """A thread posts the proofs that state a place: one still geolocated or given up on
    is a slide of the video, and no post of its thread."""
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    photo = _upload_png(client, cid)
    _proof(client, cid, "Placed", photo, coords="48.858400, 2.294500", scene={"video": video, "moments": [{"start": 0.5}]})
    _proof(client, cid, "Unplaced", photo, scene={"video": video, "moments": [{"start": 1.0}]})
    _proof(client, cid, "Given up", photo, scene={"video": video, "moments": [{"start": 2.0}]})
    assert client.put(f"/api/cases/{cid}/proofs/Given up/abandon", json={"reason": "blurry"}).status_code == 200

    rows = _listed(client, cid)

    assert {name: rows[name]["postable"] for name in ("Placed", "Unplaced", "Given up")} == {
        "Placed": True, "Unplaced": False, "Given up": False,
    }


@needs_ffmpeg
def test_a_proof_traced_to_its_video_by_its_frames_is_a_slide_of_it(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    _proof(client, cid, "Tower", _cut(client, cid, video, 2.0))

    row = _listed(client, cid)["Tower"]

    assert (row["video"], row["slide"], row["slides"]) == (video, 1, 1)


@needs_ffmpeg
def test_the_list_of_300_proofs_looks_them_up_in_one_pass(client, tmp_path, monkeypatch):
    """Each proof's slide is read for the whole list at once: the number of entity scans
    stays the same whether the case holds 10 proofs or 300, and the list stays quick."""
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    frame = _cut(client, cid, video, 1.0)
    real = Case.find_entity

    def counted():
        asked = []

        def find_entity(self, **kwargs):
            asked.append(kwargs)
            return real(self, **kwargs)

        monkeypatch.setattr(Case, "find_entity", find_entity)
        try:
            started = time.perf_counter()
            rows = client.get(f"/api/cases/{cid}/proofs").json()
            took = time.perf_counter() - started
        finally:
            monkeypatch.setattr(Case, "find_entity", real)
        return len(asked), rows, took

    def prove(at):
        _proof(client, cid, f"Slide {at}", frame, scene={"video": video, "moments": [{"start": (at % 40) * 0.1}]})

    for at in range(10):
        prove(at)
    few, _rows, _took = counted()
    for at in range(10, 300):
        prove(at)
    many, rows, took = counted()

    assert many == few
    assert len(rows) == 300
    assert {row["slides"] for row in rows} == {300}
    assert sorted(row["slide"] for row in rows) == list(range(1, 301))
    print(f"\nGET /proofs, 300 proofs on one video: {took * 1000:.0f} ms")
    assert took < 5


def test_the_slides_of_no_proof_are_none(client):
    cid = _case(client)
    assert scenes_engine.proof_slides(Case.open(cid), []) == {}


# -- a proof of a scene is deleted with its scene, or gives it back ------------------------


def _made_from_a_scene(client, cid, tmp_path):
    video = _video(client, cid, tmp_path)
    _save_work(client, cid, video, scenes=[
        {"id": "s1", "start": 0.4, "end": 0.9, "label": "Mast?"},
        {"id": "s2", "start": 2.0, "end": 3.5, "label": "Bridge?"},
    ])
    _proof(client, cid, "Bridge", _cut(client, cid, video, 2.5))
    put = client.put(f"/api/cases/{cid}/proofs/Bridge/scene", json={"moments": [{"start": 2.1, "end": 3.4}], "draft": "s2"})
    assert put.status_code == 200, put.text
    return video


@needs_ffmpeg
def test_a_proof_deleted_by_default_gives_its_scene_back(client, tmp_path):
    cid = _case(client)
    video = _made_from_a_scene(client, cid, tmp_path)

    deleted = client.delete(f"/api/cases/{cid}/proofs/Bridge")

    assert deleted.status_code == 200, deleted.text
    assert (deleted.json()["scene"], deleted.json()["dropped"]) == ("keep", [])
    assert [d["id"] for d in _drafts(client, cid, video)] == ["s1", "s2"]


@needs_ffmpeg
def test_a_proof_deleted_with_its_scene_takes_it_out_of_the_work_and_gives_nothing_back(client, tmp_path):
    cid = _case(client)
    video = _made_from_a_scene(client, cid, tmp_path)

    deleted = client.delete(f"/api/cases/{cid}/proofs/Bridge", params={"scene": "drop"})

    assert deleted.status_code == 200, deleted.text
    assert (deleted.json()["scene"], deleted.json()["dropped"]) == ("drop", ["s2"])
    assert [d["id"] for d in _drafts(client, cid, video)] == ["s1"]
    assert [s["id"] for s in _work(client, cid, video)["spec"]["scenes"]] == ["s1"]
    assert not Case.open(cid).resolve_inside(layout.proof_spec_rel("Bridge")).exists()

    # restored, the proof states its moments as it did: its scene is proved again
    restored = client.post(f"/api/cases/{cid}/trash/{deleted.json()['trash']}/restore")
    assert restored.status_code == 200, restored.text
    listed = _scenes(client, cid, video)["scenes"]
    assert [(s["kind"], s.get("id") or s.get("proof")) for s in listed] == [("draft", "s1"), ("proof", "Bridge")]
    [proof] = [s for s in listed if s["kind"] == "proof"]
    assert proof["moments"] == [{"start": 2.1, "end": 3.4}]

    # deleted again, the default gives a scene of its moments back, its draft being gone
    client.delete(f"/api/cases/{cid}/proofs/Bridge")
    given = [d for d in _drafts(client, cid, video) if d["id"] != "s1"]
    assert [(d["start"], d["end"], d["label"]) for d in given] == [(2.1, 3.4, "Bridge")]


@needs_ffmpeg
def test_a_proof_with_no_draft_deleted_with_its_scene_gives_nothing_back(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    _proof(client, cid, "Proof 32", _cut(client, cid, video, 1.0), scene={"video": video, "moments": [{"start": 0.5, "end": 1.5}]})

    deleted = client.delete(f"/api/cases/{cid}/proofs/Proof 32", params={"scene": "drop"})

    assert deleted.status_code == 200, deleted.text
    assert _drafts(client, cid, video) == []


@needs_ffmpeg
def test_a_delete_refused_puts_the_scene_back(client, tmp_path, monkeypatch):
    """One go: when the Trash refuses the proof, the scene taken out of the work is back."""
    from azimut.api import proofs as proofs_api

    cid = _case(client)
    video = _made_from_a_scene(client, cid, tmp_path)

    def refuse(*_args, **_kwargs):
        raise RuntimeError("the trash is full")

    monkeypatch.setattr(proofs_api, "delete_by_path", refuse)
    with pytest.raises(RuntimeError):
        client.delete(f"/api/cases/{cid}/proofs/Bridge", params={"scene": "drop"})

    assert [s["id"] for s in _work(client, cid, video)["spec"]["scenes"]] == ["s1", "s2"]
    assert Case.open(cid).resolve_inside(layout.proof_spec_rel("Bridge")).exists()


def test_a_delete_asked_with_another_word_is_refused(client):
    cid = _case(client)
    assert client.delete(f"/api/cases/{cid}/proofs/Bridge", params={"scene": "maybe"}).status_code == 422
