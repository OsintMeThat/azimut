"""Geo Proof's list of proofs, as it reads a video's slides.

The list says, for a proof resting on a video, which video and where it stands among
that video's proofs, so Open proof and Geo Proof's home can tag it ``clip.mp4 · 2/4``.
"""

from __future__ import annotations

import time

from test_scenes import _case, _cut, _proof, _save_work, _upload_png, _video, needs_ffmpeg

from azimut.engine import scenes as scenes_engine
from azimut.workspace import Case


def _listed(client, cid):
    res = client.get(f"/api/cases/{cid}/proofs")
    assert res.status_code == 200, res.text
    return {row["name"]: row for row in res.json()}


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
