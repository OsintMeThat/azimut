"""Auto-stitch: quad fitting math (pure) and the OpenCV layout solver.

The solver is exercised against a synthetic scene cut into overlapping crops, so
the right answer is known up front: the crops' offset is what we asked for, and
the solved quads must reproduce it.
"""

import random

import pytest
from PIL import Image, ImageDraw

from azimut.engine import stitch


def _scene(width=900, height=500, seed=7) -> Image.Image:
    """A richly textured scene — random blobs give the detector real features."""
    rng = random.Random(seed)
    img = Image.new("RGB", (width, height), (18, 20, 28))
    draw = ImageDraw.Draw(img)
    for _ in range(220):
        x, y = rng.randrange(width), rng.randrange(height)
        r = rng.randrange(6, 34)
        color = (rng.randrange(40, 255), rng.randrange(40, 255), rng.randrange(40, 255))
        if rng.random() < 0.5:
            draw.ellipse([x, y, x + r, y + r], fill=color)
        else:
            draw.rectangle([x, y, x + r, y + int(r * 0.7)], fill=color)
    return img


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
