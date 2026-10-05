"""Synthetic scenes for the auto-stitch gates.

A textured scene to cut into overlapping crops, and views of one world through a
camera turned by known angles, built by direct sampling so nothing under test is
used to make its own input.
"""

import math
import random

from PIL import Image, ImageDraw


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
