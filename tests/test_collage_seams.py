"""Stitched pieces meet halfway between their middles (engine/seams.py), in the saved picture.

`tests/fixtures/collage-seams.json` names the piece each point shows, worked out one
point at a time by `tests/seamscene.py`; the canvas reads the same file
(`frontend/src/lib/seams.test.js`). `AZIMUT_WRITE_GOLDEN=1` rewrites it, and only a
change meant to move a seam should.
"""

import io
import json
import os

import numpy as np
import pytest
import seamscene
from PIL import Image

from azimut.engine import inspect as inspect_engine
from azimut.engine import seams
from azimut.workspace import Case

FIXTURE = json.loads(seamscene.FIXTURE.read_text(encoding="utf-8"))


def _png(colour, size) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, tuple(colour)).save(buf, "PNG")
    return buf.getvalue()


def _laid(client, scene):
    """A case holding a flat picture for each piece, and the collage's nodes as the export sends them."""
    cid = client.post("/api/cases", json={"name": "Seams"}).json()["id"]
    nodes = []
    for piece in scene["pieces"]:
        stitched = seams.stitched(piece["save"]["ops"])
        size = (seamscene.W, seamscene.H) if stitched else (int(piece["w"]), int(piece["h"]))
        item = client.post(
            f"/api/cases/{cid}/media/upload",
            files={"file": (f"{piece['id']}.png", io.BytesIO(_png(piece["colour"], size)), "image/png")},
        ).json()["item"]
        nodes.append({"src": {"path": item["path"], "time": None, "ops": piece["save"]["ops"]}, "quad": piece["quad"]})
    return Case.open(cid), nodes


def _shown(scene, pixels, at):
    """The piece a picture shows at a point, by its colour; None where it is empty."""
    x, y = (int(v) for v in at)
    r, g, b, a = (int(v) for v in pixels[y, x])
    if a == 0:
        return None
    assert a == 255, at
    return min(scene["pieces"], key=lambda p: sum(abs(c - d) for c, d in zip(p["colour"], (r, g, b))))["id"]


def test_the_fixture_is_the_rule_worked_point_by_point():
    built = seamscene.build()
    if os.environ.get("AZIMUT_WRITE_GOLDEN") == "1":
        seamscene.write()
    assert built == FIXTURE
    # every case the rule has: the seam moved, a hand piece kept above and below, and an empty corner
    pan = FIXTURE["pan"]["points"]
    assert any(p["stacked"] == "b" and p["shows"] == "a" for p in pan)
    assert any(p["stacked"] == "c" and p["shows"] == "h" for p in pan)
    assert any(p["stacked"] == "c" and p["shows"] == "c" and p["owner"] == "c" for p in pan)
    assert any(p.get("corner") and p["shows"] == "f" for p in FIXTURE["corner"]["points"])


@pytest.mark.parametrize("name", sorted(FIXTURE))
def test_the_saved_picture_shows_each_point_from_the_piece_the_rule_names(client, name):
    scene = FIXTURE[name]
    case, nodes = _laid(client, scene)
    width, height = scene["canvas"]
    canvas, _, _ = inspect_engine._compose_canvas(case, width=width, height=height, nodes=nodes, background=None)
    pixels = np.asarray(canvas)
    for point in scene["points"]:
        assert _shown(scene, pixels, point["at"]) == point["shows"], point


@pytest.mark.parametrize("name", sorted(FIXTURE))
def test_a_seam_never_leaves_a_pixel_emptier_than_stacking_did(client, name):
    """Nothing goes blank: a piece is hidden only under an owner already painted opaque, so the
    picture's cover is plain stacking's, pixel for pixel."""
    scene = FIXTURE[name]
    case, nodes = _laid(client, scene)
    width, height = scene["canvas"]
    canvas, _, _ = inspect_engine._compose_canvas(case, width=width, height=height, nodes=nodes, background=None)
    stacked = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    for node in nodes:
        piece, at, _, _ = inspect_engine._warp_piece(case, node, width, height)
        stacked.alpha_composite(piece, at)
    assert np.array_equal(np.asarray(canvas)[..., 3], np.asarray(stacked)[..., 3])
    # and the seams did move something
    assert not np.array_equal(np.asarray(canvas), np.asarray(stacked))


def test_straightened_pieces_keep_the_seams_once_laid_by_hand(client):
    """Straighten files each piece as the collage shows it, so the pictures, laid at their boxes in
    order with no stitch left in their recipes, still meet where the stitch met."""
    scene = FIXTURE["pan"]
    case, nodes = _laid(client, scene)
    width, height = scene["canvas"]
    filed = inspect_engine.straighten_pieces(
        case, width=width, height=height, nodes=[{**n, "label": f"Piece {i}"} for i, n in enumerate(nodes)],
        bend=[0.0] * width,
    )
    laid = [
        {"src": {"path": p["item"]["path"], "time": None, "ops": []},
         "quad": [[p["box"][0], p["box"][1]], [p["box"][2], p["box"][1]], [p["box"][2], p["box"][3]], [p["box"][0], p["box"][3]]]}
        for p in filed
    ]
    canvas, _, _ = inspect_engine._compose_canvas(case, width=width, height=height, nodes=laid, background=None)
    pixels = np.asarray(canvas)
    for point in scene["points"]:
        assert _shown(scene, pixels, point["at"]) == point["shows"], point


def test_only_the_rotation_models_warp_marks_a_stitched_piece():
    remap = {"op": "remap", "params": {"warp": "cylindrical", "r": [1, 0, 0, 0, 1, 0, 0, 0, 1]}}
    assert seams.stitched([{"op": "crop", "params": {}}, remap])
    # a planar stitch leaves the recipe alone: nothing tells it from a piece laid by hand
    assert not seams.stitched([])
    assert not seams.stitched(None)
    assert not seams.stitched([{"op": "remap", "params": {"warp": "cylindrical", "r": [1, 0, 0]}}])
    assert not seams.stitched([{"op": "crop", "params": {"x": 0, "y": 0, "w": 1, "h": 1}}])


def _area(poly):
    return abs(sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(poly, poly[1:] + poly[:1]))) / 2


def test_the_cells_split_the_canvas_halfway_between_the_middles():
    box = (0.0, 0.0, 100.0, 60.0)
    left, right = seams.cells([(20.0, 30.0), (60.0, 30.0)], box)
    # the seam on the bisector, x = 40
    assert max(x for x, _ in left) == pytest.approx(40.0) and min(x for x, _ in right) == pytest.approx(40.0)
    middles = [(10.0, 10.0), (80.0, 15.0), (45.0, 50.0), (30.0, 35.0)]
    cells = seams.cells(middles, box)
    assert sum(_area(c) for c in cells) == pytest.approx(6000.0)
    for (mx, my), cell in zip(middles, cells):
        # convex, and holding its own middle: the middle sits on one side of every edge
        sides = [(x1 - x0) * (my - y0) - (y1 - y0) * (mx - x0) for (x0, y0), (x1, y1) in zip(cell, cell[1:] + cell[:1])]
        assert all(s >= 0 for s in sides) or all(s <= 0 for s in sides)


def test_two_middles_at_one_place_give_the_cell_to_the_piece_drawn_later():
    first, second = seams.cells([(30.0, 30.0), (30.0, 30.0)], (0.0, 0.0, 60.0, 60.0))
    assert first == [] and _area(second) == pytest.approx(3600.0)
