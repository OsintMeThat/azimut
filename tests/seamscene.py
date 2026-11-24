"""Collages of stitched frames, for the seams' tests.

Frames stitched as Azimut's rotation model leaves them: a remap op each, placed as
the upright rectangle of its warped picture. Which piece a point shows is worked out
here one point at a time, straight from the rule (engine/seams.py), and written to
`tests/fixtures/collage-seams.json`, which the compositor's tests and the canvas's
(`frontend/src/lib/seams.test.js`) both read.

- `pan`: three frames across, at three heights so the seams slope, and a picture
  laid by hand over the second and under the third.
- `corner`: a frame looking down, its lower corners empty, and over it a frame its
  analyst drew three times larger, whose middle lies far above: in the first frame's
  cell, where it has no pixel, the second still shows.
- `warped`: two frames across, and over the first the same view a moment later, one
  of its corners pulled by hand: no longer the rectangle the stitch laid, it is laid
  by hand, whole on top, and the other two meet as if it were not there.
"""

import json
import math
import re
from pathlib import Path

import numpy as np

from azimut.engine import seams, stitch

FIXTURE = Path(__file__).parent / "fixtures" / "collage-seams.json"
W, H = 360, 240
FOCAL = 330.0
# a point is kept this far from every edge and every seam, so a pixel's rounding cannot decide it
# (and so the canvas's outline, traced a little inside a warp's edge, holds it too)
MARGIN = 6.0
PER_KIND = 6
# each collage, its pieces bottom to top: ("frame", id, yaw, pitch down, drawn larger by, its top right
# corner moved by hand [dx, dy] or None) in degrees, or ("hand", id, [left, top] as shares of the
# stitched frames' extent, [width, height])
SCENES = {
    "pan": (
        ("frame", "a", -26.0, 6.0, 1.0, None),
        ("frame", "b", 0.0, 16.0, 1.0, None),
        ("hand", "h", [0.62, 0.55], [150.0, 90.0]),
        ("frame", "c", 25.0, 4.0, 1.0, None),
    ),
    "corner": (
        ("frame", "e", 0.0, 22.0, 1.0, None),
        ("frame", "f", 10.0, -14.0, 3.0, None),
    ),
    "warped": (
        ("frame", "p", -15.0, 8.0, 1.0, None),
        ("frame", "q", 15.0, 8.0, 1.0, None),
        ("frame", "r", -12.0, 9.0, 1.0, [34.0, 22.0]),
    ),
}
COLOURS = {"a": [220, 60, 50], "b": [50, 170, 70], "c": [60, 90, 220], "h": [240, 200, 40],
           "e": [150, 60, 200], "f": [230, 140, 30], "p": [200, 40, 120], "q": [40, 180, 190],
           "r": [250, 250, 250]}


def _rotation(yaw: float, pitch: float) -> np.ndarray:
    y, p = math.radians(yaw), math.radians(pitch)
    turn = np.array([[math.cos(y), 0, math.sin(y)], [0, 1, 0], [-math.sin(y), 0, math.cos(y)]])
    lift = np.array([[1, 0, 0], [0, math.cos(p), math.sin(p)], [0, -math.sin(p), math.cos(p)]])
    return turn @ lift


def _remap(rotation: np.ndarray) -> dict:
    return {"warp": "cylindrical", "focal": round(FOCAL / W, 9), "aspect": 1.0, "ppx": 0.5, "ppy": 0.5,
            "r": [round(float(v), 9) for v in rotation.reshape(9)], "scale": round(FOCAL / W, 9), "gain": 1.0}


def _to_own(quad: list, w: float, h: float):
    """Canvas points to a piece's own pixels, through the map its quad warps its picture by."""
    rows = []
    for (x, y), (u, v) in zip(quad, [(0, 0), (w, 0), (w, h), (0, h)]):
        rows.append([x, y, 1, 0, 0, 0, -u * x, -u * y, -u])
        rows.append([0, 0, 0, x, y, 1, -v * x, -v * y, -v])
    m = np.linalg.svd(np.asarray(rows, dtype=np.float64))[2][-1].reshape(3, 3)

    def at(x: float, y: float) -> tuple[float, float]:
        u, v, z = m @ np.array([x, y, 1.0])
        return u / z, v / z

    return at


def _scene(layout: tuple) -> dict:
    from PIL import Image

    cv2 = stitch._cv2()
    blank = Image.new("RGB", (W, H), (128, 128, 128))
    frames = {}
    for kind, name, *rest in layout:
        if kind != "frame":
            continue
        yaw, pitch, larger, _ = rest
        params = _remap(_rotation(yaw, pitch))
        k, r, scale = stitch._camera_at(params, W, H)
        x, y, _, _ = cv2.PyRotationWarper("cylindrical", scale).warpRoi((W, H), k, r)
        warped = stitch.apply_warp(blank, params)
        w, h = warped.size
        # drawn larger about its middle
        mx, my = x + w / 2, y + h / 2
        frames[name] = (params, (mx - w * larger / 2, my - h * larger / 2), (w * larger, h * larger), warped)
    x0 = min(at[0] for _, at, _, _ in frames.values())
    y0 = min(at[1] for _, at, _, _ in frames.values())
    right = max(at[0] + size[0] for _, at, size, _ in frames.values()) - x0
    bottom = max(at[1] + size[1] for _, at, size, _ in frames.values()) - y0
    pieces, alphas = [], {}
    for kind, name, *rest in layout:
        if kind == "frame":
            params, (x, y), (qw, qh), warped = frames[name]
            left, top = round(x - x0, 3), round(y - y0, 3)
            w, h = warped.size
            ops = [{"op": "remap", "params": params}]
            moved = rest[3] or [0.0, 0.0]
        else:
            (fx, fy), (w, h) = rest
            left, top, qw, qh, ops, moved = round(fx * right, 3), round(fy * bottom, 3), w, h, [], [0.0, 0.0]
        quad = [[left, top], [round(left + qw + moved[0], 3), round(top + moved[1], 3)],
                [round(left + qw, 3), round(top + qh, 3)], [left, round(top + qh, 3)]]
        if kind == "frame":
            alphas[name] = (np.asarray(warped.getchannel("A")), _to_own(quad, w, h))
        pieces.append({
            "id": name, "save": {"path": f"media/{name}.png", "time": None, "ops": ops}, "w": w, "h": h,
            "quad": quad, "colour": COLOURS[name],
        })
    width, height = math.ceil(right), math.ceil(bottom)

    stitched = [p for p in pieces if seams.stitched(p["save"]["ops"], p["quad"])]
    middles = [seams.middle(p["quad"]) for p in stitched]
    laid = {p["id"] for p in stitched}
    cells = seams.cells(middles, (0.0, 0.0, float(width), float(height)))

    def cover(piece, x, y):
        """1 where the piece holds its picture all round the point, 0 where nothing of it is near, else None."""
        (x0, y0), (x1, y1) = piece["quad"][0], piece["quad"][2]
        if piece["id"] not in alphas:
            inside = x0 + MARGIN <= x <= x1 - MARGIN and y0 + MARGIN <= y <= y1 - MARGIN
            outside = x < x0 - MARGIN or x > x1 + MARGIN or y < y0 - MARGIN or y > y1 + MARGIN
            return 1 if inside else 0 if outside else None
        alpha, own = alphas[piece["id"]]
        # in its own pixels: a piece drawn larger keeps a wider margin on the canvas
        m = math.ceil(MARGIN)
        cx, cy = (int(round(v)) for v in own(x, y))
        window = alpha[max(0, cy - m):max(0, cy + m + 1), max(0, cx - m):max(0, cx + m + 1)]
        if window.size == 0 or (window == 0).all():
            return 0
        full = cy - m >= 0 and cx - m >= 0 and window.shape == (2 * m + 1, 2 * m + 1)
        return 1 if full and (window == 255).all() else None

    found: dict[tuple, list] = {}
    for y in np.arange(3.0, height, 6.0):
        for x in np.arange(3.0, width, 6.0):
            covers = [cover(p, x, y) for p in pieces]
            if None in covers:
                continue
            d = sorted((math.hypot(x - mx, y - my), i) for i, (mx, my) in enumerate(middles))
            (d1, i1), (d2, i2) = d[0], d[1]
            gap = math.hypot(middles[i1][0] - middles[i2][0], middles[i1][1] - middles[i2][1])
            if (d2 * d2 - d1 * d1) / (2 * gap) < MARGIN:
                continue
            owner = stitched[i1]["id"]
            # the rule, one point: a stitched piece shows unless the owner is drawn below it already
            shows = stacked = None
            drawn = False
            for piece, on in zip(pieces, covers):
                if not on:
                    continue
                stacked = piece["id"]
                if piece["id"] not in laid or not drawn:
                    shows = piece["id"]
                drawn = drawn or piece["id"] == owner
            # on the owner's rectangle where its warp left it nothing: what stacks there shows
            mine = next(p for p in pieces if p["id"] == owner)
            corner = not covers[pieces.index(mine)] and mine["quad"][0][0] <= x <= mine["quad"][2][0] and (
                mine["quad"][0][1] <= y <= mine["quad"][2][1])
            found.setdefault((stacked, shows, owner, corner), []).append([float(x), float(y)])
    # a few points of each kind, spread over where that kind lies
    points = []
    for (stacked, shows, owner, corner), at in sorted(found.items(), key=str):
        take = min(PER_KIND, len(at))
        for i in range(take):
            point = {"at": at[i * len(at) // take], "shows": shows, "stacked": stacked, "owner": owner}
            points.append({**point, "corner": True} if corner else point)
    return {
        "canvas": [width, height],
        "pieces": pieces,
        "cells": {p["id"]: [[round(x, 6), round(y, 6)] for x, y in cell] for p, cell in zip(stitched, cells)},
        "points": points,
    }


def build() -> dict:
    """Each collage: its canvas, its pieces, its stitched pieces' cells and points with the piece each shows."""
    return {name: _scene(layout) for name, layout in SCENES.items()}


def write() -> None:
    text = json.dumps(build(), indent=1)
    # a list of numbers on one line
    text = re.sub(r"\[\s+([-\d.eE,\s]+?)\s+\]", lambda m: "[" + ", ".join(v.strip() for v in m.group(1).split(",")) + "]", text)
    FIXTURE.write_text(text + "\n", encoding="utf-8")
