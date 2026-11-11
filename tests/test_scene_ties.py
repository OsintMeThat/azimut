"""What ties a proof's panel to a video's scene without being cut from it.

A video's frames, the collages of those frames, and the pictures made over them on the
map (a Horizon capture of a collage, say) all come from the video. A proof laying any of
them out is a proof of that video's scene: the server walks each panel up its derivation
to the footage, and a capture a scene gathered while it was geolocated points at that
scene. Geo Proof then says which scene the proof takes up, by the rule its frames follow.
"""

from __future__ import annotations

import io
import subprocess

import pytest
from PIL import Image

from azimut.engine import links as link_engine
from azimut.engine import media as media_engine
from azimut.engine import scenes as scenes_engine
from azimut.workspace import Case

needs_ffmpeg = pytest.mark.skipif(not media_engine.ffmpeg_available(), reason="ffmpeg not installed")

QUAD = [[0, 0], [64, 0], [64, 48], [0, 48]]


def _case(client, name="Ties") -> str:
    return client.post("/api/cases", json={"name": name}).json()["id"]


def _png(color=(120, 60, 30), size=(80, 60)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "PNG")
    return buf.getvalue()


def _video(client, cid, tmp_path, name="clip.mp4", pattern="testsrc") -> str:
    path = tmp_path / name
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"{pattern}=s=64x48:r=10:d=4",
         "-pix_fmt", "yuv420p", str(path)],
        check=True,
    )
    with path.open("rb") as fh:
        res = client.post(f"/api/cases/{cid}/media/upload", files={"file": (name, fh, "video/mp4")})
    assert res.status_code == 200, res.text
    return res.json()["item"]["path"]


def _upload(client, cid, name="photo.png", color=(10, 200, 90)) -> str:
    res = client.post(f"/api/cases/{cid}/media/upload", files={"file": (name, io.BytesIO(_png(color)), "image/png")})
    assert res.status_code == 200, res.text
    return res.json()["item"]["path"]


def _cut(client, cid, video, time) -> str:
    res = client.post(f"/api/cases/{cid}/inspect/save-frames", json={"items": [{"path": video, "time": time}]})
    assert res.status_code == 200, res.text
    return res.json()["saved"][0]["item"]["path"]


def _collage(client, cid, pieces, label="Collage 22") -> str:
    """A collage laid out from these (path, time) pieces, exported as the Collage tool does."""
    res = client.post(f"/api/cases/{cid}/inspect/compose", json={
        "width": 200, "height": 60, "background": None, "label": label, "collage": None,
        "nodes": [{"src": {"path": p, "time": t, "ops": []}, "quad": QUAD} for p, t in pieces],
    })
    assert res.status_code == 200, res.text
    return res.json()["item"]["path"]


_shades = iter(range(1, 10_000))


def _horizon(client, cid, photo=None, name="Ridge capture") -> dict:
    """A capture of Horizon's view, the photo it shows laid over it."""
    shade = next(_shades)
    form = {"filename": f"{name} {shade}", "lat": "16.0187", "lon": "45.5286", "heading": "303.7", "fov": "30.1"}
    if photo:
        form["photo"] = photo
    res = client.post(
        f"/api/cases/{cid}/horizon/captures",
        files={"image": ("capture.png", io.BytesIO(_png((shade % 255, 40, 90))), "image/png")},
        data=form,
    )
    assert res.status_code == 200, res.text
    return res.json()


def _satellite(client, cid) -> dict:
    """A capture filed by Satellite's screenshot route, made over nothing in the case."""
    client.put("/api/settings/keys", json={"google_js": "AIza.js"})
    shade = next(_shades)
    res = client.post(
        f"/api/cases/{cid}/satellite/screenshot",
        files={"image": ("shot.png", io.BytesIO(_png((shade % 255, 80, 40))), "image/png")},
        data={"lat": "48.8584", "lon": "2.2945", "zoom": "18", "provider": "google-js"},
    )
    assert res.status_code == 200, res.text
    return res.json()


def _scenes(client, cid, path, scenes):
    res = client.put(f"/api/cases/{cid}/inspect/work", json={"path": path, "spec": {"frames": [], "scenes": scenes}})
    assert res.status_code == 200, res.text


def _geolocate(client, cid, video, draft):
    res = client.put(f"/api/cases/{cid}/geolocating", json={"video": video, "draft": draft})
    assert res.status_code == 200, res.text


def _ties(client, cid, *panels):
    res = client.post(f"/api/cases/{cid}/scenes/ties", json={"panels": list(panels)})
    assert res.status_code == 200, res.text
    return res.json()["ties"]


def _proof(client, cid, title, *srcs) -> str:
    spec = {"panels": [{"id": f"p{i}", "src": s} for i, s in enumerate(srcs)]}
    res = client.post(f"/api/cases/{cid}/proofs", json={"title": title, "spec": spec})
    assert res.status_code == 200, res.text
    return res.json()["name"]


def _queue_scenes(client, cid):
    res = client.get(f"/api/cases/{cid}/scenes/queue")
    assert res.status_code == 200, res.text
    return {(row["video"], scene["id"]) for row in res.json()["files"] for scene in row["scenes"]}


# -- the walk ---------------------------------------------------------------------------


@needs_ffmpeg
def test_a_capture_made_over_a_frame_carries_the_frame_s_instant(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    frame = _cut(client, cid, video, 1.5)
    capture = _horizon(client, cid, photo=frame)["path"]
    assert _ties(client, cid, capture) == [{"src": capture, "video": video, "times": [1.5], "scene": None}]
    # the frame itself is read off the panel by Geo Proof, as it always was
    assert _ties(client, cid, frame) == []


@needs_ffmpeg
def test_a_capture_made_over_a_collage_carries_every_piece_s_instant(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    # as Collage 22 was made: the video's own pieces, each at its instant
    collage = _collage(client, cid, [(video, 3.2), (video, 3.0), (video, 3.1)])
    photo = _horizon(client, cid, photo=collage, name="Collage 22 photo")["path"]
    terrain = _horizon(client, cid, photo=collage, name="Collage 22 terrain")["path"]
    ties = _ties(client, cid, photo, collage, terrain)
    assert ties == [
        {"src": photo, "video": video, "times": [3.0, 3.1, 3.2], "scene": None},
        {"src": terrain, "video": video, "times": [3.0, 3.1, 3.2], "scene": None},
    ]
    # a collage of frames Inspect cut walks up the same way
    frames = [_cut(client, cid, video, 0.5), _cut(client, cid, video, 0.8)]
    of_frames = _collage(client, cid, [(frames[0], None), (frames[1], None)], label="Frames")
    capture = _horizon(client, cid, photo=of_frames)["path"]
    assert _ties(client, cid, capture) == [{"src": capture, "video": video, "times": [0.5, 0.8], "scene": None}]


@needs_ffmpeg
def test_a_capture_of_a_capture_is_walked_up_but_never_past_the_depth(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    collage = _collage(client, cid, [(video, 2.0)])
    chain = [collage]
    for _ in range(scenes_engine.TIE_DEPTH + 1):
        chain.append(_horizon(client, cid, photo=chain[-1])["path"])
    # the deepest still reached is TIE_DEPTH steps from the collage
    reached = chain[scenes_engine.TIE_DEPTH]
    assert _ties(client, cid, reached) == [{"src": reached, "video": video, "times": [2.0], "scene": None}]
    assert _ties(client, cid, chain[-1]) == []


@needs_ffmpeg
def test_a_derivation_that_loops_ends_and_still_finds_the_footage(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    frame = _cut(client, cid, video, 1.0)
    first = _horizon(client, cid, photo=frame)["path"]
    second = _horizon(client, cid, photo=first)["path"]
    loose = [_upload(client, cid, "a.png", (1, 2, 3)), _upload(client, cid, "b.png", (4, 5, 6))]
    case = Case.open(cid)
    ids = {path: case.find_entity(attr="path", value=path)["id"] for path in [first, second, *loose]}
    # a loop written behind the app's back: the first capture made from the second too
    case.add_link(ids[first], ids[second], link_engine.DERIVED_FROM, by="test")
    case.add_link(ids[loose[0]], ids[loose[1]], link_engine.DERIVED_FROM, by="test")
    case.add_link(ids[loose[1]], ids[loose[0]], link_engine.DERIVED_FROM, by="test")
    assert _ties(client, cid, second) == [{"src": second, "video": video, "times": [1.0], "scene": None}]
    assert _ties(client, cid, *loose) == []


@needs_ffmpeg
def test_a_collage_of_two_videos_is_a_picture_of_its_own(client, tmp_path):
    cid = _case(client)
    one = _video(client, cid, tmp_path, "one.mp4")
    two = _video(client, cid, tmp_path, "two.mp4", pattern="smptebars")
    mixed = _collage(client, cid, [(one, 1.0), (two, 2.0)], label="Both")
    capture = _horizon(client, cid, photo=mixed)["path"]
    assert _ties(client, cid, mixed, capture) == []
    # a photo of nothing in the case ties to nothing
    assert _ties(client, cid, _horizon(client, cid)["path"], _upload(client, cid)) == []


# -- a capture a scene gathered ----------------------------------------------------------


@needs_ffmpeg
def test_a_capture_a_scene_gathered_points_at_that_scene(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    collage = _collage(client, cid, [(video, 3.2), (video, 3.0)])
    _scenes(client, cid, video, [{"id": "sc_whole", "start": None, "end": None, "label": ""}])
    _geolocate(client, cid, video, "sc_whole")
    # Horizon's two pictures, taken while the scene is geolocated, and a map capture
    photo = _horizon(client, cid, photo=collage)
    assert photo["scene"]["id"] == "sc_whole"
    shot = _satellite(client, cid)["path"]
    assert _ties(client, cid, photo["path"], shot) == [
        {"src": photo["path"], "video": video, "times": [3.0, 3.2], "scene": "sc_whole"},
        {"src": shot, "video": video, "times": [], "scene": "sc_whole"},
    ]


def test_a_capture_a_picture_s_scene_gathered_ties_to_no_video(client):
    cid = _case(client)
    picture = _upload(client, cid, "street.png")
    _scenes(client, cid, picture, [{"id": "sc_pic", "start": None, "end": None, "label": ""}])
    _geolocate(client, cid, picture, "sc_pic")
    shot = _satellite(client, cid)["path"]
    # a picture is proved by laying it out, never by a capture of it
    assert _ties(client, cid, shot) == []


def test_the_read_is_bounded_at_the_edge(client):
    cid = _case(client)
    assert client.post(f"/api/cases/{cid}/scenes/ties", json={"panels": [""]}).status_code == 422
    too_many = ["media/x.png"] * (scenes_engine.MAX_TIE_PANELS + 1)
    assert client.post(f"/api/cases/{cid}/scenes/ties", json={"panels": too_many}).status_code == 422
    assert _ties(client, cid, "media/none.png") == []


# -- the tie written ---------------------------------------------------------------------


@needs_ffmpeg
def test_a_proof_of_two_captures_takes_up_the_scene_and_the_queue_drops_it(client, tmp_path):
    """The owner's case: a whole video to geolocate, its collage matched in Horizon, the
    proof made of Horizon's two pictures. Take it up states the scene, the To-do drops it,
    and its Undo gives the scene back and the proof its panels alone."""
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    collage = _collage(client, cid, [(video, 3.2), (video, 3.0), (video, 3.1)])
    _scenes(client, cid, video, [{"id": "sc_whole", "start": None, "end": None, "label": ""}])
    _geolocate(client, cid, video, "sc_whole")
    pictures = [_horizon(client, cid, photo=collage, name=part)["path"] for part in ("photo", "terrain")]
    name = _proof(client, cid, "Proof 100", *pictures)
    assert (video, "sc_whole") in _queue_scenes(client, cid)
    # made from captures alone, it rests on no frame: the video is not its own yet
    assert client.get(f"/api/cases/{cid}/proofs/{name}").json().get("scene") is None

    took = client.put(f"/api/cases/{cid}/proofs/{name}/scene", json={"moments": [], "video": video, "draft": "sc_whole"})
    assert took.status_code == 200, took.text
    assert (took.json()["video"], took.json()["draft"], took.json()["stated"]) == (video, "sc_whole", True)
    assert (video, "sc_whole") not in _queue_scenes(client, cid)
    # a proof that takes the scene up ends its geolocating
    assert client.get(f"/api/cases/{cid}/geolocating").json()["geolocating"] is None
    listed = client.get(f"/api/cases/{cid}/scenes", params={"video": video}).json()
    assert [(row["kind"], row.get("proof")) for row in listed["scenes"]] == [("proof", name)]
    assert listed["taken"] == ["sc_whole"]

    # the Undo of its first time: the scene back to geolocate, and nothing stated
    undone = client.put(f"/api/cases/{cid}/proofs/{name}/scene", json={"moments": [], "video": video, "traced": True})
    assert undone.status_code == 200, undone.text
    assert client.get(f"/api/cases/{cid}/proofs/{name}").json().get("scene") is None
    assert (video, "sc_whole") in _queue_scenes(client, cid)


@needs_ffmpeg
def test_a_proof_states_only_a_video_its_panels_come_from(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    other = _video(client, cid, tmp_path, "other.mp4", pattern="smptebars")
    capture = _horizon(client, cid, photo=_cut(client, cid, video, 1.0))["path"]
    name = _proof(client, cid, "Ridge", capture, _upload(client, cid))
    refused = client.put(f"/api/cases/{cid}/proofs/{name}/scene", json={"moments": [], "video": other})
    assert refused.status_code == 422
    # with no video asked, the one its panels are tied to
    timed = client.put(f"/api/cases/{cid}/proofs/{name}/scene", json={"moments": [{"start": 1.0, "end": None}]})
    assert timed.status_code == 200, timed.text
    assert timed.json()["video"] == video
