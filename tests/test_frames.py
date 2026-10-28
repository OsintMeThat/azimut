"""A collage of a pan read as frames on a bubble: directions read back exactly, hand frames tied by overlap."""

import math

import numpy as np
import pytest

from azimut.engine import frames
from framescene import FOCAL, H, W, _canvas, _collage, _rotation

def _angle(a: np.ndarray, b: np.ndarray) -> float:
    return math.degrees(math.acos(float(np.clip(a @ b / np.linalg.norm(a) / np.linalg.norm(b), -1, 1))))


def test_stitched_frames_read_back_the_directions_they_were_filmed_in():
    pieces, origin, rotations = _collage((-30.0, 0.0, 30.0))
    model = frames.Model(pieces)
    # the lens the stitch says: the frames' own, from its focal and their width
    assert frames.lens_of(model) == pytest.approx(2 * math.degrees(math.atan(W / 2 / FOCAL)), abs=0.05)
    for azimuth, elevation in ((-35.0, 2.0), (-5.0, 6.0), (12.0, 1.0), (33.0, 5.0)):
        a, e = math.radians(azimuth), math.radians(elevation)
        direction = np.array([math.sin(a) * math.cos(e), -math.sin(e), math.cos(a) * math.cos(e)])
        frame = rotations[int(np.argmin([abs(azimuth - yaw) for yaw in (-30.0, 0.0, 30.0)]))]
        u, v = _canvas(direction, frame, origin)
        ray = model.rays(np.array([u]), np.array([v]), model.per_radian)[0]
        assert _angle(ray, direction) < 0.05


def test_the_virtual_camera_is_level_and_the_trace_keeps_its_shape():
    pieces, origin, rotations = _collage((-30.0, 0.0, 30.0), pitch=8.0)
    model = frames.Model(pieces)
    np.testing.assert_allclose(model.up(), [0, -1, 0], atol=1e-6)
    # a level skyline 3° up across the whole pan, laid on the collage as the analyst traces it
    azimuths = np.linspace(-38.0, 38.0, 40)
    pts = []
    for azimuth in azimuths:
        a, e = math.radians(azimuth), math.radians(3.0)
        direction = np.array([math.sin(a) * math.cos(e), -math.sin(e), math.cos(a) * math.cos(e)])
        frame = rotations[int(np.argmin([abs(azimuth - yaw) for yaw in (-30.0, 0.0, 30.0)]))]
        pts.append(_canvas(direction, frame, origin))
    width = max(p.quad[:, 0].max() for p in pieces)
    height = max(p.quad[:, 1].max() for p in pieces)
    px = np.array([p[0] for p in pts])
    py = np.array([p[1] for p in pts])
    x = px / width * 2 - 1
    y = (height / 2 - py) / width * 2
    reading = frames.read(model, x, y, np.empty(0), np.empty(0), (width, height))
    assert reading is not None and reading.kept.all()
    from azimut.engine import skymatch
    seen_azimuth, seen_elevation = skymatch.directions(reading.x, reading.y, fov=reading.lens)
    # level, as filmed: the camera's own tilt is gone, and the pan's width is whole
    np.testing.assert_allclose(seen_elevation, 3.0, atol=0.05)
    np.testing.assert_allclose(np.diff(seen_azimuth), np.diff(azimuths), atol=0.05)
    assert reading.span == pytest.approx(60 + 2 * math.degrees(math.atan(W / 2 / FOCAL)), abs=4.0)


def test_the_level_is_the_one_the_analyst_laid_when_the_stitch_is_rolled():
    # a short stitch whose own up is 8° off the world's, as a few frames of a wider pan leave it
    pieces, origin, rotations = _collage((-30.0, 0.0, 30.0))
    roll = math.radians(8.0)
    world = np.array([[math.cos(roll), -math.sin(roll), 0], [math.sin(roll), math.cos(roll), 0], [0, 0, 1]])
    up = world @ np.array([0.0, -1.0, 0.0])

    def seen_at(azimuth, elevation):
        """Where a direction of the world lands on the collage as stitched."""
        a, e = math.radians(azimuth), math.radians(elevation)
        direction = world @ np.array([math.sin(a) * math.cos(e), -math.sin(e), math.cos(a) * math.cos(e)])
        frame = rotations[int(np.argmin([abs(azimuth - yaw) for yaw in (-30.0, 0.0, 30.0)]))]
        return np.array(_canvas(direction, frame, origin))

    # the analyst turns the pieces on the canvas until the horizon lies level
    left, right = seen_at(-30.0, 0.0), seen_at(30.0, 0.0)
    turn = -math.atan2(right[1] - left[1], right[0] - left[0])
    spin = np.array([[math.cos(turn), -math.sin(turn)], [math.sin(turn), math.cos(turn)]])
    laid = [p.quad @ spin.T for p in pieces]
    corner = np.min(np.concatenate(laid), axis=0)
    moved = [frames.Piece(quad=q - corner, size=p.size, crop=p.crop, source=p.source, remap=p.remap) for q, p in zip(laid, pieces)]
    model = frames.Model(moved)
    export = (float(max(p.quad[:, 0].max() for p in moved)), float(max(p.quad[:, 1].max() for p in moved)))
    assert _angle(model.up(), up) == pytest.approx(8.0, abs=0.5)
    assert _angle(model.level(export), up) < 1.0
    # rows placed on less than half their width say too little: the stitch's up stands
    np.testing.assert_allclose(model.level((export[0] * 3, export[1])), model.up(), atol=1e-9)
    # a level skyline reads level through the layout's up, where the stitch's alone would climb across the pan
    azimuths = np.linspace(-38.0, 38.0, 40)
    pts = np.array([spin @ seen_at(azimuth, 3.0) - corner for azimuth in azimuths])
    x = pts[:, 0] / export[0] * 2 - 1
    y = (export[1] / 2 - pts[:, 1]) / export[0] * 2
    reading = frames.read(model, x, y, np.empty(0), np.empty(0), export)
    from azimut.engine import skymatch
    _, elevation = skymatch.directions(reading.x, reading.y, fov=reading.lens)
    np.testing.assert_allclose(elevation, 3.0, atol=0.3)


def test_a_stitch_laid_as_stitched_keeps_its_own_level():
    pieces, _, _ = _collage((-30.0, 0.0, 30.0), pitch=4.0)
    model = frames.Model(pieces)
    export = (float(max(p.quad[:, 0].max() for p in pieces)), float(max(p.quad[:, 1].max() for p in pieces)))
    assert _angle(model.level(export), model.up()) < 0.1


def test_a_frame_laid_by_hand_is_tied_to_its_neighbours_by_their_overlap():
    pieces, origin, rotations = _collage((-30.0, 0.0), pitch=4.0, hand=25.0)
    model = frames.Model(pieces)
    assert model.place(model.per_radian) == [True, True, True]
    truth = _rotation(25.0, 4.0)
    a, e = math.radians(35.0), math.radians(2.0)
    direction = np.array([math.sin(a) * math.cos(e), -math.sin(e), math.cos(a) * math.cos(e)])
    cam = truth.T @ direction
    # the hand frame is a plain picture: its pixel, then where its quad lays that pixel on the collage
    pixel = np.array([W / 2 + FOCAL * cam[0] / cam[2], H / 2 + FOCAL * cam[1] / cam[2]])
    quad = pieces[-1].quad
    to_canvas = frames._homography(np.array([[0, 0], [W, 0], [W, H], [0, H]], float), quad)
    u, v = frames._apply(to_canvas, np.array([pixel[0]]), np.array([pixel[1]]))
    ray = model.rays(u, v, model.per_radian)[0]
    # a quad laid by its corners only approximates the cylinder: under a degree, as a hand lays it by eye
    assert _angle(ray, direction) < 1.0
    # its lens is read from the angle its drawn width spans, the stitched frames' scale
    assert model._focal(2, model.per_radian) == pytest.approx(FOCAL, rel=0.01)


def test_a_collage_with_no_frame_stitched_says_no_lens():
    pieces, _, _ = _collage((-30.0, 0.0))
    hand = [frames.Piece(quad=p.quad, size=p.size, crop=p.crop, source=p.source) for p in pieces]
    model = frames.Model(hand)
    assert frames.lens_of(model) is None
    assert frames.read(model, np.zeros(6), np.zeros(6), np.empty(0), np.empty(0), (100.0, 50.0)) is None


def test_a_search_on_a_stitched_collage_reads_its_trace_frame_by_frame(monkeypatch):
    from azimut.engine import finder, horizon_finds, inspectwork

    pieces, origin, rotations = _collage((-30.0, 0.0, 30.0))
    model = frames.Model(pieces)
    width = float(max(p.quad[:, 0].max() for p in pieces))
    height = float(max(p.quad[:, 1].max() for p in pieces))
    said = {"collage": "Pan", "frames": 3, "stitched": 3, "lens": round(frames.lens_of(model), 2), "span": 100.0,
            "export": [width, height]}
    monkeypatch.setattr(inspectwork, "frames_of", lambda case, path: (model, said))
    azimuths = np.linspace(-30.0, 30.0, 30)
    pts = []
    for azimuth in azimuths:
        a, e = math.radians(azimuth), math.radians(2.0 + azimuth / 20)
        direction = np.array([math.sin(a) * math.cos(e), -math.sin(e), math.cos(a) * math.cos(e)])
        pts.append(_canvas(direction, rotations[int(np.argmin([abs(azimuth - y) for y in (-30.0, 0.0, 30.0)]))], origin))
    x = np.array([p[0] for p in pts]) / width * 2 - 1
    y = (height / 2 - np.array([p[1] for p in pts])) / width * 2
    trace = finder.Trace(x=x, y=y, half_width=600.0, fov=60.0, within=(30.0, 110.0),
                         marks=None)
    ask = {"photo": {"path": "media/Pan.png", "kind": "image"}, "alignments": []}
    plan = finder.Plan(area=[(0.0, 0.0)] * 3)
    _, read, framed = horizon_finds.on_frames(None, ask, plan, trace)
    assert framed["collage"] == "Pan" and framed["lens"] == pytest.approx(said["lens"], abs=0.01)
    # with where each point of the collage was read, for the view to lay it the same way
    mesh = framed["mesh"]
    assert (mesh["across"], mesh["down"]) == (frames.MESH_ACROSS, frames.MESH_DOWN)
    assert len(mesh["points"]) == (mesh["across"] + 1) * (mesh["down"] + 1)
    middle = mesh["points"][(mesh["down"] // 2) * (mesh["across"] + 1):][: mesh["across"] + 1]
    xs = [point[0] for point in middle if point is not None]
    assert len(xs) > mesh["across"] // 2 and all(b > a for a, b in zip(xs, xs[1:]))
    # the lens is the frames', known; the trace keeps every point and its shape as filmed
    assert read.known and read.within is None and read.fov == pytest.approx(frames.lens_of(model))
    from azimut.engine import skymatch
    azimuth, elevation = skymatch.directions(read.x, read.y, fov=read.fov)
    np.testing.assert_allclose(np.diff(azimuth), np.diff(azimuths), atol=0.05)
    np.testing.assert_allclose(elevation, 2.0 + azimuths / 20, atol=0.05)
    # a curve laid over the picture since, or a photo of another kind, leaves it read as one photo
    for other in ({**ask, "photo": {**ask["photo"], "bend": 0.1}}, {**ask, "photo": {"path": "media/v.mp4", "kind": "video"}}):
        assert horizon_finds.on_frames(None, other, plan, trace)[2] is None
    # a collage nearly all laid by hand is read as one picture: its frames tied by their overlaps bend the pan
    monkeypatch.setattr(inspectwork, "frames_of", lambda case, path: (model, {**said, "frames": 12, "stitched": 1}))
    assert horizon_finds.on_frames(None, ask, plan, trace)[2] is None
    monkeypatch.setattr(inspectwork, "frames_of", lambda case, path: (model, {**said, "frames": 4, "stitched": 1}))
    assert horizon_finds.on_frames(None, ask, plan, trace)[2] is not None
