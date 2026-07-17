"""Auto-stitch: quad fitting math (pure) and the OpenCV layout solvers.

The solvers are exercised against synthetic scenes, so the right answer is known
up front. Planar gets a scene cut into overlapping crops: the crops' offset is
what we asked for, and the solved quads must reproduce it. The rotation model gets
views rendered through a camera turned by known angles — built here by direct
sampling, so nothing under test is used to make its own input.
"""

import math
import random

import pytest
from PIL import Image, ImageDraw

from azimut.engine import stitch


def _scene(width=900, height=500, seed=7, blobs=220) -> Image.Image:
    """A richly textured scene — random blobs give the detector real features."""
    rng = random.Random(seed)
    img = Image.new("RGB", (width, height), (18, 20, 28))
    draw = ImageDraw.Draw(img)
    for _ in range(blobs):
        x, y = rng.randrange(width), rng.randrange(height)
        r = rng.randrange(6, 34)
        color = (rng.randrange(40, 255), rng.randrange(40, 255), rng.randrange(40, 255))
        if rng.random() < 0.5:
            draw.ellipse([x, y, x + r, y + r], fill=color)
        else:
            draw.rectangle([x, y, x + r, y + int(r * 0.7)], fill=color)
    return img


def _pan(angles, width=520, height=420, focal=520.0, seed=5) -> list[Image.Image]:
    """Views of one world through a pinhole camera yawed by each of ``angles``.

    The world is a 360°-wide cylindrical scene; each view samples it through the
    camera's rays, which is exactly the situation the planar model cannot express
    and the rotation model can.
    """
    import cv2
    import numpy as np

    world = np.asarray(_scene(4000, 900, seed=seed, blobs=3000))
    wh, ww = world.shape[:2]
    world_focal = ww / (2 * math.pi)

    out = []
    ys, xs = np.mgrid[0:height, 0:width].astype(np.float32)
    for deg in angles:
        x = (xs - width / 2) / focal
        y = (ys - height / 2) / focal
        theta = np.arctan2(x, np.ones_like(x)) + math.radians(deg)
        map_x = ((theta * world_focal) % ww).astype(np.float32)
        map_y = ((y / np.sqrt(x**2 + 1)) * world_focal + wh / 2).astype(np.float32)
        out.append(Image.fromarray(cv2.remap(world, map_x, map_y, cv2.INTER_LINEAR)))
    return out


def _widths(quads):
    return [max(p[0] for p in q) - min(p[0] for p in q) for q in quads]


def _centroid(quad):
    return (sum(p[0] for p in quad) / 4, sum(p[1] for p in quad) / 4)


# --- pure math -------------------------------------------------------------


def test_fit_quads_to_canvas_centres_and_preserves_aspect():
    # A 200x100 constellation into a 400x400 canvas: uniform scale, so it fills
    # the width (minus margin) and stays centred vertically rather than stretching.
    quads = [[[0, 0], [200, 0], [200, 100], [0, 100]]]
    out = stitch.fit_quads_to_canvas(quads, 400, 400, margin=0.0)[0]
    assert out[0] == pytest.approx([0, 100])
    assert out[2] == pytest.approx([400, 300])


def test_fit_quads_to_canvas_keeps_relative_geometry():
    quads = [
        [[0, 0], [100, 0], [100, 100], [0, 100]],
        [[100, 0], [200, 0], [200, 100], [100, 100]],
    ]
    a, b = stitch.fit_quads_to_canvas(quads, 800, 400)
    # Side-by-side before, side-by-side after: b's left edge meets a's right edge.
    assert a[1][0] == pytest.approx(b[0][0])
    assert a[1][1] == pytest.approx(b[0][1])


def test_fit_quads_to_canvas_handles_empty():
    assert stitch.fit_quads_to_canvas([], 100, 100) == []


def test_quad_ok_accepts_a_plain_rectangle():
    assert stitch.quad_ok([[0, 0], [10, 0], [10, 10], [0, 10]])


def test_quad_ok_rejects_non_finite_and_collapsed_and_folded():
    assert not stitch.quad_ok([[0, 0], [float("inf"), 0], [10, 10], [0, 10]])
    assert not stitch.quad_ok([[0, 0], [0, 0], [0, 0], [0, 0]])  # collapsed
    # Bow-tie: corners 2 and 3 swapped, so the quad folds over itself.
    assert not stitch.quad_ok([[0, 0], [10, 0], [0, 10], [10, 10]])


# --- solver ----------------------------------------------------------------


def test_solve_layout_recovers_a_known_horizontal_offset():
    scene = _scene()
    left = scene.crop((0, 0, 500, 500))
    right = scene.crop((300, 0, 800, 500))  # 200px of overlap, 300px offset

    solved = stitch.solve_layout([left, right], width=1200, height=600)

    assert solved["dropped"] == []
    assert sorted(solved["quads"]) == [0, 1]
    quad_a, quad_b = solved["quads"][0], solved["quads"][1]
    # The solver works in its own fitted canvas scale, so check the ratio the
    # crops actually encode: a 300px offset across a 500px-wide piece.
    width_a = quad_a[1][0] - quad_a[0][0]
    offset = _centroid(quad_b)[0] - _centroid(quad_a)[0]
    assert offset / width_a == pytest.approx(300 / 500, abs=0.06)


def test_solve_layout_places_pieces_inside_the_canvas():
    scene = _scene(seed=11)
    pieces = [scene.crop((0, 0, 500, 500)), scene.crop((300, 0, 800, 500))]

    solved = stitch.solve_layout(pieces, width=1000, height=800)

    for quad in solved["quads"].values():
        for x, y in quad:
            assert -1 <= x <= 1001
            assert -1 <= y <= 801


def test_solve_layout_drops_a_piece_that_matches_nothing():
    scene = _scene(seed=3)
    pieces = [
        scene.crop((0, 0, 500, 500)),
        scene.crop((300, 0, 800, 500)),
        _scene(width=500, height=500, seed=999),  # unrelated scene
    ]

    solved = stitch.solve_layout(pieces, width=1000, height=600)

    # The stranger is reported, never guessed at — the analyst hand-places it.
    assert solved["dropped"] == [2]
    assert sorted(solved["quads"]) == [0, 1]


def test_solve_layout_rejects_a_lone_piece():
    with pytest.raises(ValueError, match="at least two"):
        stitch.solve_layout([_scene(width=200, height=200)], width=400, height=400)


def test_solve_layout_raises_when_nothing_overlaps():
    pieces = [_scene(width=400, height=400, seed=1), _scene(width=400, height=400, seed=2)]
    with pytest.raises(RuntimeError, match="no overlap"):
        stitch.solve_layout(pieces, width=800, height=600)


# --- rotation model --------------------------------------------------------


def test_rotation_layout_keeps_pieces_even_where_planar_blows_them_up():
    """The reason the panorama modes exist, stated as a test.

    Seven views across a 90° pan. The planar model has to divide each piece by its
    cosine from the anchor, so the end pieces balloon; the cylinder is the surface
    the camera actually swept, so every piece keeps its size.

    How badly planar blows up depends on which piece it anchors to (worst at an
    end, mildest from the middle), so the bar here is only "visibly uneven" — the
    claim under test is the cylinder's evenness, which holds either way.
    """
    views = _pan([-45, -30, -15, 0, 15, 30, 45])

    planar = stitch.solve_layout(views, width=1600, height=800)
    cylindrical = stitch.solve_rotation_layout(views, width=1600, height=800, warp="cylindrical")

    assert cylindrical["dropped"] == []
    assert sorted(cylindrical["quads"]) == list(range(7))
    flat = _widths(planar["quads"].values())
    round_ = _widths(cylindrical["quads"].values())
    assert max(flat) / min(flat) > 2  # the distortion we are fixing
    assert max(round_) / min(round_) == pytest.approx(1.0, abs=0.1)


def test_rotation_layout_orders_pieces_along_the_pan():
    views = _pan([-30, 0, 30])
    solved = stitch.solve_rotation_layout(views, width=1600, height=800)
    xs = [_centroid(solved["quads"][i])[0] for i in range(3)]
    assert xs[0] < xs[1] < xs[2]


def test_rotation_layout_places_pieces_inside_the_canvas():
    solved = stitch.solve_rotation_layout(_pan([-20, 0, 20]), width=1000, height=800)
    for quad in solved["quads"].values():
        for x, y in quad:
            assert -1 <= x <= 1001
            assert -1 <= y <= 801


def test_rotation_layout_returns_a_remap_per_placed_piece():
    solved = stitch.solve_rotation_layout(_pan([-20, 0, 20]), width=1200, height=600, warp="spherical")
    assert sorted(solved["remaps"]) == sorted(solved["quads"])
    for params in solved["remaps"].values():
        assert params["warp"] == "spherical"
        assert len(params["r"]) == 9
        assert params["focal"] > 0 and params["scale"] > 0


def test_rotation_layout_drops_a_piece_that_matches_nothing():
    views = _pan([-20, 0, 20])
    views.append(_scene(width=520, height=420, seed=999))  # unrelated scene

    solved = stitch.solve_rotation_layout(views, width=1200, height=600)

    # Same promise as the planar solver: the stranger is reported, never guessed at.
    assert solved["dropped"] == [3]
    assert sorted(solved["quads"]) == [0, 1, 2]
    assert 3 not in solved["remaps"]


def test_rotation_layout_rejects_a_lone_piece():
    with pytest.raises(ValueError, match="at least two"):
        stitch.solve_rotation_layout([_scene(width=200, height=200)], width=400, height=400)


def test_rotation_layout_raises_when_nothing_overlaps():
    pieces = [_scene(width=400, height=400, seed=1), _scene(width=400, height=400, seed=2)]
    with pytest.raises(RuntimeError, match="no overlap"):
        stitch.solve_rotation_layout(pieces, width=800, height=600)


def test_rotation_layout_rejects_an_unknown_warp():
    with pytest.raises(ValueError, match="unknown panorama warp"):
        stitch.solve_rotation_layout(_pan([0, 20]), width=800, height=600, warp="planar")


# --- the remap op ----------------------------------------------------------


def test_apply_warp_reproduces_the_solved_shape_and_marks_the_footprint():
    views = _pan([-20, 0, 20])
    solved = stitch.solve_rotation_layout(views, width=1200, height=600)
    quad = solved["quads"][0]

    out = stitch.apply_warp(views[0], solved["remaps"][0])

    # The op must hand the compositor the very shape the solver measured, or the
    # piece would not fill the quad it was placed in.
    solved_aspect = (quad[1][0] - quad[0][0]) / (quad[3][1] - quad[0][1])
    assert out.width / out.height == pytest.approx(solved_aspect, rel=0.01)
    # Curved projection: the corners fall outside the piece and must stay clear,
    # or they paint over whatever the piece overlaps.
    assert out.mode == "RGBA"
    alpha = out.getchannel("A")
    assert alpha.getpixel((0, 0)) == 0
    assert alpha.getpixel((out.width // 2, out.height // 2)) == 255


def test_apply_warp_is_resolution_independent():
    """The params are fractions, so a full-res re-derivation is the same shape."""
    views = _pan([-20, 0, 20])
    solved = stitch.solve_rotation_layout(views, width=1200, height=600)
    params = solved["remaps"][1]

    small = stitch.apply_warp(views[1], params)
    large = stitch.apply_warp(views[1].resize((views[1].width * 3, views[1].height * 3)), params)

    assert large.width / large.height == pytest.approx(small.width / small.height, rel=0.01)
    assert large.width / small.width == pytest.approx(3.0, rel=0.02)


def test_apply_warp_applies_the_exposure_gain():
    views = _pan([-20, 0, 20])
    params = dict(stitch.solve_rotation_layout(views, width=1200, height=600)["remaps"][0])
    params["gain"] = 0.5

    plain = stitch.apply_warp(views[0], {**params, "gain": 1.0}).convert("RGB")
    dim = stitch.apply_warp(views[0], params).convert("RGB")

    assert _mean(dim) == pytest.approx(_mean(plain) * 0.5, rel=0.02)


def test_apply_warp_rejects_an_unknown_warp():
    with pytest.raises(ValueError, match="unknown panorama warp"):
        stitch.apply_warp(_scene(width=100, height=100), {"warp": "toroidal"})


def _mean(img):
    import numpy as np

    return float(np.asarray(img).mean())
