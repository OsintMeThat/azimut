"""Auto-stitch: quad fitting math (pure) and the OpenCV layout solvers.

The solvers are exercised against synthetic scenes, so the right answer is known
up front. Planar gets a scene cut into overlapping crops: the crops' offset is
what we asked for, and the solved quads must reproduce it. The rotation model gets
views rendered through a camera turned by known angles — built by direct sampling
in `stitchscene.py`, so nothing under test is used to make its own input.
"""

import math

import pytest
from PIL import Image

from azimut.engine import stitch
from stitchscene import _pan, _scene


def _overlaid(images, box=(18, 18, 138, 88), seed=41) -> list[Image.Image]:
    """The same textured patch burnt into every image at the same pixel.

    Stands in for what a video actually carries: a platform logo, a channel bug, a
    timestamp. Textured rather than flat, because a flat patch has no keypoints and
    would prove nothing.
    """
    x0, y0, x1, y1 = box
    logo = _scene(x1 - x0, y1 - y0, seed=seed, blobs=90)
    out = []
    for img in images:
        copy = img.copy()
        copy.paste(logo, (x0, y0))
        out.append(copy)
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


def test_canvas_for_layout_takes_the_layouts_own_extent():
    quads = [[[0, 0], [1000, 0], [1000, 400], [0, 400]]]
    assert stitch.canvas_for_layout(quads, margin=0.0) == (1000, 400)


def test_canvas_for_layout_leaves_room_for_the_fitting_margin():
    # The point of the size: fitting the layout into it scales the geometry by
    # exactly one, so the pieces land at the resolution they were solved at.
    quads = [[[0, 0], [1000, 0], [1000, 400], [0, 400]]]
    fitted = stitch.fit_quads_to_canvas(quads, *stitch.canvas_for_layout(quads))[0]
    assert fitted[1][0] - fitted[0][0] == pytest.approx(1000, abs=2)


def test_canvas_for_layout_counts_source_pixels_per_solved_unit():
    quads = [[[0, 0], [500, 0], [500, 200], [0, 200]]]
    assert stitch.canvas_for_layout(quads, detail=3.0, margin=0.0) == (1500, 600)


def test_canvas_for_layout_never_shrinks_the_canvas_it_was_given():
    quads = [[[0, 0], [100, 0], [100, 50], [0, 50]]]
    assert stitch.canvas_for_layout(quads, minimum=(1600, 800), margin=0.0) == (1600, 800)


def test_canvas_for_layout_bounds_a_long_layout_by_its_side():
    quads = [[[0, 0], [60000, 0], [60000, 20000], [0, 20000]]]
    width, height = stitch.canvas_for_layout(quads, margin=0.0)
    assert max(width, height) == stitch.MAX_CANVAS_DIM
    # Both sides shrink together, so the clamped canvas still carries the shape.
    assert width / height == pytest.approx(3.0, abs=0.01)


def test_canvas_for_layout_bounds_a_layout_by_its_area():
    quads = [[[0, 0], [8000, 0], [8000, 6000], [0, 6000]]]
    width, height = stitch.canvas_for_layout(quads, margin=0.0)
    assert width * height <= stitch.MAX_CANVAS_PIXELS
    assert width / height == pytest.approx(8000 / 6000, abs=0.01)


def test_canvas_for_layout_leaves_a_canvas_already_past_the_bounds_alone():
    """The bounds hold what the solver asks for, not what the analyst set. A
    canvas already past them is a resolution they chose, and a function whose job
    is to grow one must never be the thing that shrinks it — the pieces already
    on it would be scaled down with it."""
    quads = [[[0, 0], [8000, 0], [8000, 6000], [0, 6000]]]
    big = (8192, 8192)  # 67 MP: what the compose route accepts, past the area bound

    assert stitch.canvas_for_layout(quads, minimum=big, margin=0.0) == big


def test_canvas_for_layout_handles_empty():
    assert stitch.canvas_for_layout([], minimum=(320, 240)) == (320, 240)


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

    canvas = solved["canvas"]
    for quad in solved["quads"].values():
        for x, y in quad:
            assert -1 <= x <= canvas["width"] + 1
            assert -1 <= y <= canvas["height"] + 1


def test_solve_layout_grows_the_canvas_rather_than_shrinking_the_pieces():
    # The canvas the caller has is smaller than one piece. Fitting the stitch into
    # it would throw away most of the pixels it was solved from, so the answer
    # comes back on a canvas that holds the layout at its own scale instead.
    scene = _scene(seed=13)
    pieces = [scene.crop((0, 0, 500, 500)), scene.crop((300, 0, 800, 500))]

    solved = stitch.solve_layout(pieces, width=240, height=200)

    canvas = solved["canvas"]
    assert canvas["width"] > 240 and canvas["height"] > 200
    widths = [quad[1][0] - quad[0][0] for quad in solved["quads"].values()]
    assert max(widths) == pytest.approx(500, rel=0.05)


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


def test_solve_layout_says_why_it_left_each_piece_out(monkeypatch):
    """A stranger's detail matches nothing; a blank piece and one painted out whole have nothing to
    match; a piece that matched but projected degenerately fell off the canvas."""
    scene = _scene(seed=3)
    pieces = [
        scene.crop((0, 0, 500, 500)),
        scene.crop((300, 0, 800, 500)),
        _scene(width=500, height=500, seed=999),
        Image.new("RGB", (500, 500), (90, 90, 90)),
        scene.crop((200, 0, 700, 500)),
    ]
    whole = [{"points": [[0.5, 0.5]], "radius": 1.0}]

    solved = stitch.solve_layout(pieces, width=1000, height=600, exclude=[None, None, None, None, whole])

    assert solved["dropped"] == [2, 3, 4]
    assert solved["why"] == [stitch.LEFT_NO_OVERLAP, stitch.LEFT_NO_DETAIL, stitch.LEFT_NO_DETAIL]

    # the second piece's projection folds: it matched, and fell off the canvas
    checked = []

    def second_folds(quad):
        checked.append(quad)
        return len(checked) != 2

    monkeypatch.setattr(stitch, "quad_ok", second_folds)
    solved = stitch.solve_layout(pieces[:3], width=1000, height=600)
    assert (solved["dropped"], solved["why"]) == ([1, 2], [stitch.LEFT_OFF_CANVAS, stitch.LEFT_NO_OVERLAP])


def test_why_a_piece_was_left_out_reads_its_points_and_its_projection():
    points = [500, 3, 0, 19, 20, 800]
    assert stitch._why_left_out([5, 1, 2, 3, 4], points, {5}) == [
        "no-detail", "no-detail", "no-detail", "no-overlap", "off-canvas",
    ]


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
    canvas = solved["canvas"]
    for quad in solved["quads"].values():
        for x, y in quad:
            assert -1 <= x <= canvas["width"] + 1
            assert -1 <= y <= canvas["height"] + 1


def test_rotation_layout_sizes_the_canvas_in_source_pixels():
    """The rotation model solves on a 1000px work copy of every piece, so its
    geometry has to be read back up to the source before the canvas is sized —
    otherwise the same pan filmed in 4K would come back at the same detail as a
    thumbnail of it. Three times the pixels in, three times the canvas out."""
    small = _pan([-20, 0, 20])
    big = [v.resize((v.width * 3, v.height * 3)) for v in small]

    # A canvas at the floor, so the answer is the layout's own size and nothing else.
    coarse = stitch.solve_rotation_layout(small, width=16, height=16)
    fine = stitch.solve_rotation_layout(big, width=16, height=16)

    assert fine["canvas"]["width"] == pytest.approx(3 * coarse["canvas"]["width"], rel=0.05)
    assert fine["canvas"]["height"] == pytest.approx(3 * coarse["canvas"]["height"], rel=0.05)
    # And the pan is worth more than the collage's default canvas, which is the
    # size it used to be squeezed into.
    assert fine["canvas"]["width"] > 1600


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


def test_rotation_layout_says_why_it_left_each_piece_out():
    views = _pan([-20, 0, 20])
    views.append(_scene(width=520, height=420, seed=999))
    views.append(Image.new("RGB", (520, 420), (90, 90, 90)))

    solved = stitch.solve_rotation_layout(views, width=1200, height=600)

    assert solved["dropped"] == [3, 4]
    assert solved["why"] == [stitch.LEFT_NO_OVERLAP, stitch.LEFT_NO_DETAIL]


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


class _FakeCv2:
    """Just enough of cv2 for `_solve_cameras`, with either solver set to blow up.

    OpenCV reports a scene it cannot resolve two ways — `False`, or an assertion
    thrown from inside the solver — and only the first was ever handled. Driven
    through a stand-in rather than through real pictures, because the input that
    makes the real adjuster assert is a property of the OpenCV build, not
    something a fixture can promise across versions.
    """

    error = type("error", (Exception,), {})

    def __init__(self, raise_in: str):
        self._raise_in = raise_in

    class _Camera:
        def __init__(self):
            import numpy as np

            self.R = np.eye(3, dtype="float64")
            self.focal = 500.0

    def _apply(self, which):
        if self._raise_in == which:
            raise self.error("(-215:Assertion failed) !err.empty() in function 'update'")
        return True, [self._Camera(), self._Camera()]

    def detail_HomographyBasedEstimator(self):
        outer = self

        class _Estimator:
            def apply(self, feats, pairwise, _):
                return outer._apply("estimator")

        return _Estimator()

    def detail_BundleAdjusterRay(self):
        outer = self

        class _Adjuster:
            def setConfThresh(self, value): ...

            def setRefinementMask(self, mask): ...

            def apply(self, feats, pairwise, cameras):
                return outer._apply("adjuster")

        return _Adjuster()


@pytest.mark.parametrize(
    ("raise_in", "says"),
    [("estimator", "estimate the camera rotations"), ("adjuster", "refine the camera rotations")],
)
def test_solve_cameras_answers_an_opencv_assertion_like_a_refusal(raise_in, says):
    # Pieces that match just enough to be paired but not enough to be solved reach
    # the ray adjuster and make it assert. Uncaught, that is a 500 and a traceback
    # where the analyst should be reading that these pictures do not solve.
    with pytest.raises(RuntimeError, match=says):
        stitch._solve_cameras(_FakeCv2(raise_in), feats=[], pairwise=[])


# --- fixed overlays --------------------------------------------------------


def _points(*groups):
    """Keypoint arrays from ``(x, y)`` lists, as the solvers hand them over."""
    import numpy as np

    return [np.asarray(g, dtype=np.float32) for g in groups]


def test_static_points_flags_what_sits_in_the_same_place():
    pinned = [(10.0, 10.0), (12.0, 40.0), (60.0, 15.0)]
    moving = [[(100.0 + 30 * i, 20.0 * k) for k in range(12)] for i in range(4)]
    points = _points(*[pinned + m for m in moving])

    static = stitch._static_points(points, [(400, 300)] * 4)

    assert [sorted(s) for s in static] == [[0, 1, 2]] * 4


def test_static_points_says_nothing_from_a_single_peer():
    """Two frames of a still camera and two frames sharing a logo are the same
    picture — and there the identity the overlay pushes for is the right answer."""
    points = _points([(10.0, 10.0), (12.0, 40.0)], [(10.0, 10.0), (12.0, 40.0)])

    assert stitch._static_points(points, [(400, 300)] * 2) == [set(), set()]


def test_static_points_leaves_a_scene_that_simply_does_not_move():
    """Everything pinned means the camera is what stands still. Strip that and the
    solver has nothing left to match with, so the piece keeps all of it."""
    shared = [(10.0 * i, 20.0 + i) for i in range(30)]
    points = _points(shared, shared, shared)

    assert stitch._static_points(points, [(400, 300)] * 3) == [set()] * 3


def test_static_points_only_compares_pieces_of_the_same_geometry():
    """Same pixel on a different canvas is not the same place, so no overlay claim."""
    shared = [(10.0, 10.0), (12.0, 40.0), (60.0, 15.0)]
    noise = [[(100.0 + 30 * i, 20.0 * k) for k in range(12)] for i in range(3)]
    points = _points(*[shared + n for n in noise])

    static = stitch._static_points(points, [(400, 300), (400, 300), (640, 480)])

    assert static == [set(), set(), set()]


def test_solve_layout_refuses_a_stitch_only_the_overlay_supports():
    """The regression this rejection exists for, and the reason it is worth having.

    Three unrelated scenes wearing the same logo: the overlay matches itself
    perfectly, so unfiltered it clears every guard here and glues the three into
    one confident panorama — geometry invented out of nothing, which is exactly
    what an analyst must never be handed.
    """
    pieces = _overlaid([_scene(width=500, height=500, seed=s) for s in (1, 2, 3)])

    with pytest.raises(RuntimeError, match="no overlap"):
        stitch.solve_layout(pieces, width=900, height=900)


def test_rotation_layout_refuses_a_stitch_only_the_overlay_supports():
    pieces = _overlaid([_scene(width=500, height=500, seed=s) for s in (4, 5, 6)])

    with pytest.raises(RuntimeError, match="no overlap"):
        stitch.solve_rotation_layout(pieces, width=900, height=900)


def test_solve_layout_still_stitches_pieces_that_wear_a_logo():
    """The other half of the bargain: dropping those keypoints must not cost the
    real overlap. Same known offset as the plain planar test, logo and all."""
    scene = _scene()
    pieces = _overlaid([scene.crop((x, 0, x + 500, 500)) for x in (0, 130, 260, 390)])

    solved = stitch.solve_layout(pieces, width=1600, height=800)

    assert solved["dropped"] == []
    width_a = solved["quads"][0][1][0] - solved["quads"][0][0][0]
    xs = [_centroid(solved["quads"][i])[0] for i in range(4)]
    for a, b in zip(xs, xs[1:]):
        assert (b - a) / width_a == pytest.approx(130 / 500, abs=0.06)


def test_rotation_layout_still_stitches_pieces_that_wear_a_logo():
    views = _overlaid(_pan([-30, -15, 0, 15, 30]))

    solved = stitch.solve_rotation_layout(views, width=1600, height=800)

    assert solved["dropped"] == []
    xs = [_centroid(solved["quads"][i])[0] for i in range(5)]
    assert xs == sorted(xs)
    widths = _widths(solved["quads"].values())
    assert max(widths) / min(widths) == pytest.approx(1.0, abs=0.1)


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


def _stitched(heading, middle, warp="cylindrical", width=400):
    """A collage piece the rotation model placed: its camera turned `heading` degrees, centred at `middle`."""
    h = math.radians(heading)
    r = [math.cos(h), 0.0, math.sin(h), 0.0, 1.0, 0.0, -math.sin(h), 0.0, math.cos(h)]
    remap = {"op": "remap", "params": {"warp": warp, "focal": 1.2, "aspect": 1, "ppx": 0.5, "ppy": 0.5, "r": r,
                                       "scale": 1.2, "gain": 1}}
    x0 = middle - width / 2
    return {"save": {"path": "media/clip.mp4", "time": 1.0, "ops": [remap]},
            "quad": [[x0, 10], [x0 + width, 10], [x0 + width, 300], [x0, 300]]}


def test_a_stitched_strip_says_how_many_pixels_a_degree_spans():
    # 30 px a degree, the pieces 12° apart, one laid by hand beside them
    nodes = [_stitched(h, 500 + 30 * h) for h in (-12, 0, 12, 24)]
    nodes.append({"save": {"path": "media/clip.mp4", "ops": []}, "quad": [[0, 0], [100, 0], [100, 50], [0, 50]]})
    scale = stitch.strip_scale(nodes)
    assert scale["per_degree"] == pytest.approx(30.0)
    assert (scale["stitched"], scale["by_hand"], scale["warp"]) == (4, 1, "cylindrical")
    # a turn read the other way round is the same scale
    assert stitch.strip_scale([_stitched(h, 500 - 30 * h) for h in (-12, 0, 12)])["per_degree"] == pytest.approx(30.0)
    # across north, the headings are read as one turn
    across = [_stitched(170, 30 * 170), _stitched(178, 30 * 178), _stitched(-174, 30 * 186)]
    assert stitch.strip_scale(across)["per_degree"] == pytest.approx(30.0)


def test_a_strip_moved_by_hand_after_the_stitch_says_nothing():
    nodes = [_stitched(h, 500 + 30 * h) for h in (-12, 0, 12, 24)]
    nodes[2]["quad"] = [[x + 90, y] for x, y in nodes[2]["quad"]]  # dragged 3° off where its turn puts it
    assert stitch.strip_scale(nodes) is None
    # one stitched piece, pieces that do not turn, or warps that differ say nothing either
    assert stitch.strip_scale([_stitched(0, 500)]) is None
    assert stitch.strip_scale([_stitched(5, 500), _stitched(5.2, 900)]) is None
    assert stitch.strip_scale([_stitched(0, 500), _stitched(10, 800, warp="spherical")]) is None
    assert stitch.strip_scale([]) is None


@pytest.mark.parametrize("focal", [520.0, 900.0])
def test_a_pans_lens_is_read_off_its_frames(focal):
    views = _pan([-10, 0, 10], width=520, height=420, focal=focal)
    found = stitch.lens_of_pan(views)
    truth = 2 * math.degrees(math.atan(260 / focal))
    assert len(found["fovs"]) == 3
    for fov in found["fovs"].values():
        assert fov == pytest.approx(truth, rel=0.05)
    assert found["turn"] == pytest.approx(20.0, abs=1.5)


def test_a_pan_that_hardly_turns_or_frames_that_do_not_overlap_say_why():
    with pytest.raises(RuntimeError, match="hardly turned"):
        stitch.lens_of_pan(_pan([0, 1], width=520, height=420))
    with pytest.raises(RuntimeError, match="do not overlap"):
        stitch.lens_of_pan(_pan([0, 150], width=520, height=420))
    with pytest.raises(RuntimeError, match="Two frames"):
        stitch.lens_of_pan(_pan([0]))


# --- painted-out areas -----------------------------------------------------


def test_an_exclusion_mask_covers_each_stroke_as_a_trail_of_discs():
    # radius 0.1 of a 200 px width is 20 px; the stroke runs from (40, 50) to (160, 50)
    mask = stitch.exclusion_mask([{"points": [[0.2, 0.5], [0.8, 0.5]], "radius": 0.1}], (200, 100))

    assert mask.shape == (100, 200)
    assert mask[50, 100] == 0  # between the two points: the band joins them
    assert mask[50, 24] == 0 and mask[50, 176] == 0  # round ends, past the points
    assert mask[50, 15] == 255 and mask[50, 185] == 255
    assert mask[25, 100] == 255  # above the band
    assert mask[5, 5] == 255


def test_an_exclusion_mask_is_none_when_nothing_is_painted():
    assert stitch.exclusion_mask(None, (200, 100)) is None
    assert stitch.exclusion_mask([], (200, 100)) is None


def test_no_keypoint_is_found_under_a_painted_area():
    import cv2

    scene = _scene(width=800, height=500, seed=17)
    det, _ = stitch._detector(cv2)
    left_half = [{"points": [[0.0, 0.0], [0.0, 1.0]], "radius": 0.5}]

    pts, _ = stitch._features(cv2, det, scene, left_half)
    every, _ = stitch._features(cv2, det, scene)

    assert pts is not None and len(pts) < len(every)
    assert min(x for x, _ in pts) > 0.5 * 800 - 2
    # the panorama pipeline honours the same strokes
    arr = stitch._work_array(scene)
    [feats] = stitch._detail_features(cv2, [arr], [left_half])
    assert min(k.pt[0] for k in feats.keypoints) > 0.5 * arr.shape[1] - 2


def test_a_piece_painted_out_entirely_has_nothing_to_match():
    import cv2

    det, _ = stitch._detector(cv2)
    everything = [{"points": [[0.5, 0.5]], "radius": 1.0}]
    assert stitch._features(cv2, det, _scene(width=400, height=300), everything) == (None, None)


def test_painting_out_a_shared_logo_stops_it_stitching_unrelated_scenes():
    """Two pieces are too few for the overlay filter to call a logo pinned, so it
    glues two unrelated scenes together. The analyst painting it out is what
    stops that, and the stitch then refuses as it should."""
    pieces = _overlaid([_scene(width=500, height=500, seed=s) for s in (1, 2)])
    logo = [{"points": [[78 / 500, 53 / 500]], "radius": 80 / 500}]

    assert sorted(stitch.solve_layout(pieces, width=900, height=900)["quads"]) == [0, 1]
    with pytest.raises(RuntimeError, match="no overlap"):
        stitch.solve_layout(pieces, width=900, height=900, exclude=[logo, logo])


def test_painted_areas_leave_the_real_overlap_to_stitch():
    scene = _scene()
    pieces = [scene.crop((0, 0, 500, 500)), scene.crop((300, 0, 800, 500))]
    # a passer-by over the left piece's far side, outside the overlap
    passer = [{"points": [[0.1, 0.2], [0.15, 0.8]], "radius": 0.08}]

    planar = stitch.solve_layout(pieces, width=1200, height=600, exclude=[passer, None])
    width_a = planar["quads"][0][1][0] - planar["quads"][0][0][0]
    offset = _centroid(planar["quads"][1])[0] - _centroid(planar["quads"][0])[0]
    assert offset / width_a == pytest.approx(300 / 500, abs=0.06)

    views = _pan([-20, 0, 20])
    rotation = stitch.solve_rotation_layout(views, width=1200, height=600, exclude=[None, passer, None])
    assert rotation["dropped"] == []


def test_exclude_needs_one_entry_per_piece():
    scene = _scene()
    pieces = [scene.crop((0, 0, 500, 500)), scene.crop((300, 0, 800, 500))]
    with pytest.raises(ValueError, match="one entry per piece"):
        stitch.solve_layout(pieces, width=900, height=600, exclude=[None])


# --- frames of one video ---------------------------------------------------


def test_frames_of_one_video_pair_with_their_neighbours_in_time():
    sources = [("media/clip.mp4", float(t)) for t in range(8)]
    pairs = stitch.near_pairs(sources, 8)
    assert pairs == sorted({(i, i + s) for i in range(8) for s in (1, 2, 4) if i + s < 8})
    assert len(pairs) == 17  # where every pair is 28


def test_neighbours_follow_time_not_the_order_pieces_were_added():
    times = [3.0, 0.0, 2.0, 1.0, 5.0, 4.0]
    pairs = stitch.near_pairs([("media/clip.mp4", t) for t in times], 6)
    by_time = sorted(range(6), key=lambda i: times[i])
    expected = {
        tuple(sorted((by_time[r], by_time[r + s]))) for r in range(6) for s in (1, 2, 4) if r + s < 6
    }
    assert set(pairs) == expected


def test_pictures_and_other_videos_still_meet_every_piece():
    sources = [("media/a.mp4", float(t)) for t in range(6)]
    sources += [("media/photo.jpg", None), ("media/b.mp4", 1.0), ("media/b.mp4", 2.0)]
    pairs = set(stitch.near_pairs(sources, 9))
    for i in range(6):
        assert (i, 6) in pairs and (i, 7) in pairs and (i, 8) in pairs  # a picture, another video
    assert (7, 8) in pairs
    assert (0, 5) not in pairs  # frames of one video five apart


def test_nothing_is_saved_when_neighbours_are_every_pair():
    assert stitch.near_pairs(None, 5) is None
    assert stitch.near_pairs([("media/clip.mp4", float(t)) for t in range(3)], 3) is None
    assert stitch.near_pairs([("media/p.jpg", None)] * 6, 6) is None


def _pan_frames(count, step=110):
    """``count`` frames of a camera sliding ``step`` px across one scene."""
    scene = _scene(width=400 + step * count, height=420, seed=23, blobs=120 + 40 * count)
    return [scene.crop((step * k, 0, step * k + 400, 420)) for k in range(count)]


def test_a_videos_frames_stitch_on_fewer_pairs_to_the_same_layout(monkeypatch):
    frames = _pan_frames(8)
    sources = [("media/clip.mp4", 0.5 * k) for k in range(8)]
    tried = []
    real = stitch._pair_homography

    def counted(cv2, matcher, a, b, *rest):
        tried.append(1)
        return real(cv2, matcher, a, b, *rest)

    monkeypatch.setattr(stitch, "_pair_homography", counted)
    near = stitch.solve_layout(frames, width=1600, height=600, sources=sources)
    near_count = len(tried)
    tried.clear()
    every = stitch.solve_layout(frames, width=1600, height=600)

    assert (near_count, len(tried)) == (17, 28)
    assert near["dropped"] == every["dropped"] == []
    assert near["canvas"] == every["canvas"]
    for i in range(8):
        # The same layout to within 1% of the frame as drawn: fewer pairs move a corner
        # by about 2 px here, and a little more on macOS's OpenCV build.
        top_left, top_right = every["quads"][i][0], every["quads"][i][1]
        within = 0.01 * (top_right[0] - top_left[0])
        for p, q in zip(near["quads"][i], every["quads"][i]):
            assert p == pytest.approx(q, abs=within)


def test_a_frame_its_neighbours_miss_sends_the_stitch_back_to_every_pair():
    """A cut in the video: the stranger frame matches no neighbour, so the stitch
    tries every pair before leaving it out, and answers exactly as it always did."""
    frames = _pan_frames(6)
    frames.insert(3, _scene(width=400, height=420, seed=999))
    sources = [("media/clip.mp4", 0.5 * k) for k in range(7)]

    near = stitch.solve_layout(frames, width=1600, height=600, sources=sources)
    every = stitch.solve_layout(frames, width=1600, height=600)

    assert near == every
    assert near["dropped"] == [3]


def test_a_videos_frames_stitch_on_fewer_pairs_in_the_panorama_modes():
    views = _pan([-36, -24, -12, 0, 12, 24, 36])
    sources = [("media/clip.mp4", float(k)) for k in range(7)]

    near = stitch.solve_rotation_layout(views, width=1600, height=800, sources=sources)
    every = stitch.solve_rotation_layout(views, width=1600, height=800)

    assert near["dropped"] == every["dropped"] == []
    xs = [_centroid(near["quads"][i])[0] for i in range(7)]
    assert xs == sorted(xs)
    width = near["quads"][3][1][0] - near["quads"][3][0][0]
    for i in range(7):
        assert _centroid(near["quads"][i])[0] == pytest.approx(_centroid(every["quads"][i])[0], abs=0.02 * width)


def test_a_cut_in_the_video_falls_back_to_every_pair_in_the_panorama_modes():
    views = _pan([-24, -12, 0, 12, 24])
    views.insert(2, _scene(width=520, height=420, seed=999))
    sources = [("media/clip.mp4", float(k)) for k in range(6)]

    solved = stitch.solve_rotation_layout(views, width=1600, height=800, sources=sources)

    assert solved["dropped"] == [2]
    assert sorted(solved["quads"]) == [0, 1, 3, 4, 5]


# --- reliability -----------------------------------------------------------


def test_the_same_pieces_always_stitch_the_same_way():
    """OpenCV's matcher draws on a global random generator every earlier stitch
    has moved on, so the same panorama used to come back a pixel or so apart
    from one press to the next. Each solve now starts it from the same seed."""
    import cv2

    views = _pan([-30, -15, 0, 15, 30])
    answers = []
    for state in (1, 2, 3):
        cv2.setRNGSeed(state)  # whatever ran before
        answers.append(stitch.solve_rotation_layout(views, width=900, height=600))
    assert answers[0] == answers[1] == answers[2]


class _Matches:
    """A matcher answering with the knn pairs it is given."""

    def __init__(self, knn):
        self._knn = knn

    def knnMatch(self, query, train, k):
        return self._knn


def test_a_pair_is_believed_on_distinct_points_not_one_point_counted_many_times():
    """A picture with a few points soaks up matches from a busy one, several to
    each of its points; counted that way a pair of unrelated pictures (a cloudy
    sky and a mountain) cleared every guard. Each point now answers once."""
    import cv2
    import numpy as np

    rng = np.random.default_rng(3)
    pts_a = rng.uniform(0, 400, size=(12, 2)).astype(np.float32)
    # every point of a seen three times over in b, as SIFT does at one spot
    pts_b = np.repeat(pts_a + np.float32([30, 10]), 3, axis=0)
    knn = [
        [cv2.DMatch(q, q // 3, 0.1 * (1 + q % 3)), cv2.DMatch(q, (q // 3 + 1) % 12, 9.0)]
        for q in range(len(pts_b))
    ]
    desc = np.zeros((36, 128), np.float32)

    H, inliers = stitch._pair_homography(cv2, _Matches(knn), (pts_a, desc[:12]), (pts_b, desc))

    assert (H, inliers) == (None, 0)  # 12 distinct points, under MIN_INLIERS
    unique = [[cv2.DMatch(q, q, 0.1), cv2.DMatch(q, (q + 1) % 36, 9.0)] for q in range(36)]
    pts_a36 = rng.uniform(0, 400, size=(36, 2)).astype(np.float32)
    H, inliers = stitch._pair_homography(
        cv2, _Matches(unique), (pts_a36, desc), (pts_a36 + np.float32([30, 10]), desc)
    )
    assert H is not None and inliers == 36


def test_the_ransac_tolerance_is_counted_on_the_detectors_grid(monkeypatch):
    """Keypoints are found on a 1000 px copy, so their error is a work pixel, not a
    source pixel: a 4000 px piece gets four times the tolerance in its own pixels.
    Held at 4 source pixels it shrank to one work pixel and a lens's barrel was
    enough to refuse a true pair of phone photos."""
    seen = []
    real = stitch._pair_homography

    def spy(cv2, matcher, a, b, ransac_px):
        seen.append(ransac_px)
        return real(cv2, matcher, a, b, ransac_px)

    monkeypatch.setattr(stitch, "_pair_homography", spy)
    scene = _scene(width=1400, height=700, seed=31)
    big = [scene.crop((0, 0, 900, 700)).resize((3600, 2800)), scene.crop((500, 0, 1400, 700)).resize((3600, 2800))]
    stitch.solve_layout(big, width=900, height=600)
    assert seen == [pytest.approx(4.0 * 3600 / 1000)]


def test_a_faded_picture_is_looked_at_again_with_a_lower_contrast_floor():
    """Haze, mist or a washed-out frame leave OpenCV's default detector nothing to
    find, and the stitch said the pieces do not overlap."""
    import cv2

    faded = Image.eval(_scene(seed=21), lambda v: 120 + v // 14)
    pieces = [faded.crop((0, 0, 500, 500)), faded.crop((300, 0, 800, 500))]
    det, _ = stitch._detector(cv2)
    assert stitch._features(cv2, det, pieces[0]) == (None, None)  # OpenCV's floor alone

    solved = stitch.solve_layout(pieces, width=1200, height=600)

    assert solved["dropped"] == []
    width_a = solved["quads"][0][1][0] - solved["quads"][0][0][0]
    offset = _centroid(solved["quads"][1])[0] - _centroid(solved["quads"][0])[0]
    assert offset / width_a == pytest.approx(300 / 500, abs=0.06)


def test_a_pair_too_alike_for_opencv_keeps_its_confidence():
    """OpenCV zeroes a pair scoring above 3 as too close to add anything: frames a
    moment apart in a sharp video, which then read as pieces with no overlap."""
    import cv2
    import numpy as np

    def info(inliers, matches, confidence):
        m = cv2.detail.MatchesInfo()
        m.src_img_idx, m.dst_img_idx = 0, 1
        m.num_inliers, m.confidence = inliers, confidence
        m.matches = [cv2.DMatch(k, k, 0.1) for k in range(matches)]
        m.H = np.eye(3)
        return m

    close = info(980, 1000, 0.0)  # 980 / (8 + 300) = 3.18
    stitch._undo_too_close(close)
    assert close.confidence == pytest.approx(980 / 308)

    weak = info(5, 100, 0.0)  # zero because it is weak, not because it is close
    stitch._undo_too_close(weak)
    assert weak.confidence == 0.0


def test_the_camera_solve_reads_a_bounded_sample_of_each_pairs_inliers():
    """The ray adjuster's cost grows with cameras times matches; a sharp pan's
    neighbours share some 1500 inliers each. It gets an even sample, the matches
    themselves stay whole for anything that reads them after."""
    import cv2
    import numpy as np

    def info(inliers):
        m = cv2.detail.MatchesInfo()
        m.src_img_idx, m.dst_img_idx, m.confidence = 0, 1, 2.0
        m.matches = [cv2.DMatch(k, k, 0.1) for k in range(inliers + 50)]
        m.inliers_mask = np.array([1] * inliers + [0] * 50, np.uint8)
        m.num_inliers = inliers
        m.H = np.eye(3)
        return m

    rich, poor, unused = info(1500), info(120), cv2.detail.MatchesInfo()
    thin_rich, thin_poor, thin_unused = stitch._thinned(cv2, [rich, poor, unused])

    assert thin_rich.num_inliers == int(np.asarray(thin_rich.inliers_mask).sum()) == stitch._ADJUST_INLIERS
    assert np.flatnonzero(thin_rich.inliers_mask).max() > 1400  # spread through, not the first 200
    assert rich.num_inliers == 1500 and int(np.asarray(rich.inliers_mask).sum()) == 1500
    assert thin_poor is poor and thin_unused is unused
