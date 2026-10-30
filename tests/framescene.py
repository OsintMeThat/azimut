"""A collage of a pan made from known cameras, for the frame-by-frame reading's tests.

Frames stitched as Azimut's rotation model leaves them (a remap op with each
camera's rotation and focal) and a frame laid by hand by its corners, so a test
knows every direction it reads back.
"""

import math

import numpy as np

from azimut.engine import frames, stitch

W, H = 720.0, 480.0
FOCAL = 700.0


def _rotation(yaw: float, pitch: float = 0.0) -> np.ndarray:
    """Camera to pan (OpenCV's stitch frame: x right, y down, z forward), turned by `yaw` then tilted by `pitch` up."""
    y, p = math.radians(yaw), math.radians(pitch)
    turn = np.array([[math.cos(y), 0, math.sin(y)], [0, 1, 0], [-math.sin(y), 0, math.cos(y)]])
    lift = np.array([[1, 0, 0], [0, math.cos(p), math.sin(p)], [0, -math.sin(p), math.cos(p)]])
    return turn @ lift


def _remap(rotation: np.ndarray) -> dict:
    return {"warp": "cylindrical", "focal": FOCAL / W, "aspect": 1.0, "ppx": 0.5, "ppy": 0.5,
            "r": [float(v) for v in rotation.reshape(9)], "scale": FOCAL / W, "gain": 1.0}


def _warped(params: dict) -> tuple:
    k, r, scale = stitch._camera_at(params, int(W), int(H))
    warper = stitch._cv2().PyRotationWarper("cylindrical", scale)
    return warper, k, r, warper.warpRoi((int(W), int(H)), k, r)


def _collage(yaws, pitch=4.0, hand=None):
    """Stitched frames at `yaws`, and a hand frame laid by its corners on the cylinder (`hand`: its yaw)."""
    rotations = [_rotation(yaw, pitch) for yaw in yaws]
    rois = [_warped(_remap(r))[3] for r in rotations]
    x0 = min(roi[0] for roi in rois)
    y0 = min(roi[1] for roi in rois)
    pieces = []
    for r, (rx, ry, rw, rh) in zip(rotations, rois):
        quad = np.array([[rx - x0, ry - y0], [rx - x0 + rw, ry - y0], [rx - x0 + rw, ry - y0 + rh], [rx - x0, ry - y0 + rh]], float)
        pieces.append(frames.Piece(quad=quad, size=(float(rw), float(rh)), crop=(0, 0, 1, 1), source=(W, H), remap=_remap(r)))
    if hand is not None:
        warper, k, r, _ = _warped(_remap(_rotation(hand, pitch)))
        corners = [warper.warpPoint((px, py), k, r) for px, py in ((0, 0), (W, 0), (W, H), (0, H))]
        quad = np.array([[u - x0, v - y0] for u, v in corners], float)
        pieces.append(frames.Piece(quad=quad, size=(W, H), crop=(0, 0, 1, 1), source=(W, H)))
    return pieces, (x0, y0), rotations


def _canvas(direction: np.ndarray, rotation: np.ndarray, origin) -> tuple[float, float]:
    """Where a pan direction lands on the collage through a stitched frame's warp."""
    warper, k, r, _ = _warped(_remap(rotation))
    cam = rotation.T @ direction
    pixel = k @ (cam / cam[2])
    u, v = warper.warpPoint((float(pixel[0]), float(pixel[1])), k, r)
    return u - origin[0], v - origin[1]
