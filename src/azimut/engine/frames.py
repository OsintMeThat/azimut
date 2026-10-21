"""A collage of a pan read as frames on a bubble about one eye.

A camera that turns on the spot lays every frame it films on a sphere about the
eye. A collage lays them flat, side by side, and a search that reads the collage
as one photo through one lens bends the trace wrongly as the pan widens: with
the lens left free, many places then fit by chance, each with its own lens. Read
frame by frame instead, every point of the trace keeps the direction it was
filmed in, and one eye, one lens and one heading are left to find.

Azimut's own Collage document says where each frame came from (the video and the
moment) and where it was laid (its four corners on the canvas), and the export is
that canvas trimmed to its pieces. So a point of the trace on the export belongs
to the frame drawn on top there, and to a pixel of that frame:

- A frame **Azimut stitched** carries its camera in its recipe (the rotation
  model's `remap`: a rotation, a focal length and the cylinder it was warped
  onto). Its pixels are directions on that cylinder, exactly, whatever the analyst
  did to the piece afterwards.
- A frame **laid by hand** is a plain perspective picture. Its lens is the
  angle its drawn width spans on the collage, read at the stitched frames'
  scale (a frame zoomed in on is drawn smaller to match its neighbours, so it
  spans less: each frame keeps its own zoom); with none stitched, one lens for
  the reference frame is searched and the others follow by their size. Its rotation is the one that best lays its
  pixels onto the directions of the frames it overlaps, where the analyst matched
  them by eye (Kabsch's least-squares rotation over points of the overlap).

A hand frame that overlaps nothing placed cannot be tied to the others and is
left out, its points with it. The directions are then read through one virtual
camera looking along the middle of the pan, so the search (engine/skymatch.py)
runs unchanged: the pan's heading, tilt and roll are that camera's. The stitch
expresses every frame in a frame of its own: the virtual camera is held level
about the up the stitched frames agree on, the one square to every frame's
side-to-side axis, which a camera held without roll keeps level (OpenCV's
horizontal wave correction reads it the same way).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

import numpy as np

# A hand frame is tied to the frames it overlaps through this many points across it either way,
# and needs at least this many of them in the overlap.
TIE_GRID = 16
TIE_MIN = 12
# Rays this far or farther from the virtual camera's forward, degrees, cannot be read through it.
SIDE_MAX = 80.0
# Stitched frames whose side-to-side axes lie closer than this, degrees, say too little of the up square to them.
AXIS_TURN_MIN = 3.0


@dataclass(frozen=True)
class Piece:
    """One frame as the collage lays it."""

    quad: np.ndarray  # (4, 2) its corners on the export, clockwise from the top left, pixels
    size: tuple[float, float]  # its own pixels, width and height, as the quad shows them
    crop: tuple[float, float, float, float]  # the part of the frame (or of its warp) kept: x, y, w, h fractions
    source: tuple[float, float]  # the frame's pixels as filmed, width and height
    remap: dict[str, Any] | None = None  # the rotation model's warp, for a frame Azimut stitched

    @property
    def stitched(self) -> bool:
        return self.remap is not None

    def scale(self) -> float:
        """Export pixels per pixel of the piece: how much larger the analyst drew it."""
        w, h = self.size
        top = float(np.hypot(*(self.quad[1] - self.quad[0])))
        side = float(np.hypot(*(self.quad[3] - self.quad[0])))
        return (top / w + side / h) / 2


def _homography(src: np.ndarray, dst: np.ndarray) -> np.ndarray:
    """The 3×3 map taking four points onto four others."""
    rows = []
    for (x, y), (u, v) in zip(src, dst):
        rows.append([x, y, 1, 0, 0, 0, -u * x, -u * y, -u])
        rows.append([0, 0, 0, x, y, 1, -v * x, -v * y, -v])
    _, _, vt = np.linalg.svd(np.asarray(rows, dtype=np.float64))
    h = vt[-1].reshape(3, 3)
    return h / h[2, 2]


def _apply(h: np.ndarray, x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    w = h[2, 0] * x + h[2, 1] * y + h[2, 2]
    return (h[0, 0] * x + h[0, 1] * y + h[0, 2]) / w, (h[1, 0] * x + h[1, 1] * y + h[1, 2]) / w


@dataclass
class _Placed:
    piece: Piece
    to_piece: np.ndarray  # export pixels to the piece's own
    # stitched: the cylinder's scale and the warp's corner; the camera
    warp: dict[str, Any] = field(default_factory=dict)
    rotation: np.ndarray | None = None  # hand: the frame's camera to the pan's frame


def _warp_of(piece: Piece) -> dict[str, Any]:
    """A stitched frame's cylinder: its scale and where its warped picture starts on it, in source pixels."""
    from . import stitch

    params = piece.remap or {}
    width, height = piece.source
    k, r, scale = stitch._camera_at(params, int(round(width)), int(round(height)))
    cv2 = stitch._cv2()
    warper = cv2.PyRotationWarper(str(params["warp"]), scale)
    x0, y0, ww, hh = warper.warpRoi((int(round(width)), int(round(height))), k, r)
    return {"scale": float(scale), "x0": float(x0), "y0": float(y0), "size": (float(ww), float(hh)),
            "k": np.asarray(k, dtype=np.float64), "r": np.asarray(r, dtype=np.float64), "warp": str(params["warp"])}


class Model:
    """The frames of a collage placed on one bubble: each point of the export read as a direction."""

    def __init__(self, pieces: list[Piece]):
        self.pieces = pieces
        self._placed = [
            _Placed(p, _homography(p.quad, np.array([[0, 0], [p.size[0], 0], [p.size[0], p.size[1]], [0, p.size[1]]], dtype=np.float64)))
            for p in pieces
        ]
        for one in self._placed:
            if one.piece.stitched:
                one.warp = _warp_of(one.piece)
        self.stitched = any(p.stitched for p in pieces)
        # the export's pixels a radian spans, from the stitched frames: their scale times how large they were drawn
        self.per_radian = (
            float(np.median([one.warp["scale"] * one.piece.scale() for one in self._placed if one.piece.stitched]))
            if self.stitched else None
        )

    # -- where a point lies ----------------------------------------------------------------

    def _local(self, index: int, px: np.ndarray, py: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """A piece's own pixels at export points, and whether each lies on it."""
        one = self._placed[index]
        a, b = _apply(one.to_piece, px, py)
        w, h = one.piece.size
        inside = (a >= 0) & (a <= w) & (b >= 0) & (b <= h)
        return a, b, inside

    def locate(self, px: np.ndarray, py: np.ndarray) -> np.ndarray:
        """The piece drawn on top at each export point (later pieces over earlier ones), -1 where none."""
        px = np.asarray(px, dtype=np.float64)
        py = np.asarray(py, dtype=np.float64)
        out = np.full(px.size, -1, dtype=int)
        for index in range(len(self._placed)):
            a, b, inside = self._local(index, px, py)
            if self._placed[index].piece.stitched:
                inside &= self._on_warp(index, a, b)
            out[inside] = index
        return out

    # -- directions -------------------------------------------------------------------------

    def _stitched_rays(self, index: int, a: np.ndarray, b: np.ndarray) -> np.ndarray:
        """Directions in the pan's frame (x right, y down, z forward) of a stitched piece's pixels."""
        one = self._placed[index]
        warp = one.warp
        cx, cy, cw, ch = one.piece.crop
        ww, hh = warp["size"]
        u = cx * ww + a + warp["x0"]
        v = cy * hh + b + warp["y0"]
        theta = u / warp["scale"]
        lift = v / warp["scale"]
        if warp["warp"] == "spherical":
            # OpenCV's sphere counts down from the pole above
            rays = np.stack([np.sin(lift) * np.sin(theta), -np.cos(lift), np.sin(lift) * np.cos(theta)], axis=1)
        else:
            rays = np.stack([np.sin(theta), lift, np.cos(theta)], axis=1)
        return rays / np.linalg.norm(rays, axis=1, keepdims=True)

    def _on_warp(self, index: int, a: np.ndarray, b: np.ndarray) -> np.ndarray:
        """Whether a stitched piece's pixels hold the frame (its warp leaves its corners empty)."""
        one = self._placed[index]
        rays = self._stitched_rays(index, a, b)
        cam = rays @ one.warp["r"]  # R^T d, row-wise
        src = cam @ one.warp["k"].T
        z = src[:, 2]
        with np.errstate(divide="ignore", invalid="ignore"):
            sx, sy = src[:, 0] / z, src[:, 1] / z
        width, height = one.piece.source
        return (z > 0) & (sx >= 0) & (sx <= width) & (sy >= 0) & (sy <= height)

    def _camera_rays(self, index: int, a: np.ndarray, b: np.ndarray, focal: float) -> np.ndarray:
        """A hand piece's pixels as directions from its own camera (x right, y down, z forward)."""
        piece = self._placed[index].piece
        width, height = piece.source
        cx, cy, _, _ = piece.crop
        sx = cx * width + a - width / 2
        sy = cy * height + b - height / 2
        rays = np.stack([sx, sy, np.full(sx.shape, focal)], axis=1)
        return rays / np.linalg.norm(rays, axis=1, keepdims=True)

    def _focal(self, index: int, per_radian: float) -> float:
        """A hand piece's focal length in its own pixels: the angle its drawn width spans on the collage
        (`per_radian` export pixels a radian), across its own width."""
        piece = self._placed[index].piece
        top = float(np.hypot(*(piece.quad[1] - piece.quad[0])))
        bottom = float(np.hypot(*(piece.quad[2] - piece.quad[3])))
        across = min((top + bottom) / 2 / per_radian, math.radians(170.0))
        return piece.size[0] / 2 / math.tan(across / 2)

    def up(self) -> np.ndarray:
        """The world's up in the pan's frame (x right, y down, z forward): square to the stitched frames'
        side-to-side axes, else the pan frame's own up."""
        sides = np.array([np.asarray(one.warp["r"], dtype=np.float64)[:, 0] for one in self._placed if one.piece.stitched])
        if len(sides) < 2:
            return np.array([0.0, -1.0, 0.0])
        spread = max(
            math.degrees(math.acos(float(np.clip(abs(a @ b), -1.0, 1.0)))) for i, a in enumerate(sides) for b in sides[i + 1:]
        )
        if spread < AXIS_TURN_MIN:
            return np.array([0.0, -1.0, 0.0])
        _, vectors = np.linalg.eigh(sides.T @ sides)
        axis = vectors[:, 0]
        return axis if axis[1] < 0 else -axis

    def per_radian_for(self, lens: float, reference: int | None = None) -> float:
        """The export's pixels a radian spans for a lens across the reference frame, when none was stitched."""
        index = self._reference() if reference is None else reference
        piece = self._placed[index].piece
        return piece.scale() * (piece.source[0] / 2) / math.tan(math.radians(lens) / 2)

    def _reference(self) -> int:
        """The hand frame the others are tied to when none was stitched: the one overlapping the most."""
        counts = []
        for index in range(len(self._placed)):
            counts.append(sum(1 for other in range(len(self._placed)) if other != index and self._overlap(index, other) is not None))
        return int(np.argmax(counts)) if counts else 0

    def _overlap(self, index: int, other: int) -> tuple[np.ndarray, np.ndarray] | None:
        """Export points laid on both pieces, enough of them to tie one to the other, or None."""
        quad = self._placed[index].piece.quad
        xs = np.linspace(quad[:, 0].min(), quad[:, 0].max(), TIE_GRID)
        ys = np.linspace(quad[:, 1].min(), quad[:, 1].max(), TIE_GRID)
        gx, gy = np.meshgrid(xs, ys)
        px, py = gx.ravel(), gy.ravel()
        _, _, on_one = self._local(index, px, py)
        a, b, on_other = self._local(other, px, py)
        both = on_one & on_other
        if self._placed[other].piece.stitched:
            both &= self._on_warp(other, a, b)
        if self._placed[index].piece.stitched:
            ai, bi, _ = self._local(index, px, py)
            both &= self._on_warp(index, ai, bi)
        if both.sum() < TIE_MIN:
            return None
        return px[both], py[both]

    def place(self, per_radian: float) -> list[bool]:
        """Tie every hand frame to the placed ones, nearest first; which pieces could be placed."""
        placed = [one.piece.stitched for one in self._placed]
        for one in self._placed:
            if not one.piece.stitched:
                one.rotation = None
        if not any(placed) and self._placed:
            reference = self._reference()
            self._placed[reference].rotation = np.eye(3)
            placed[reference] = True
        progress = True
        while progress:
            progress = False
            for index, one in enumerate(self._placed):
                if placed[index]:
                    continue
                ties = []
                for other in range(len(self._placed)):
                    if other == index or not placed[other]:
                        continue
                    overlap = self._overlap(index, other)
                    if overlap is not None:
                        ties.append((other, *overlap))
                if not ties:
                    continue
                own, theirs = [], []
                for other, px, py in ties:
                    a, b, _ = self._local(index, px, py)
                    own.append(self._camera_rays(index, a, b, self._focal(index, per_radian)))
                    theirs.append(self._rays_of(other, px, py, per_radian))
                c, d = np.concatenate(own), np.concatenate(theirs)
                # Kabsch: the rotation laying this frame's directions onto its neighbours'
                u, _, vt = np.linalg.svd(c.T @ d)
                sign = np.sign(np.linalg.det(vt.T @ u.T)) or 1.0
                one.rotation = vt.T @ np.diag([1.0, 1.0, sign]) @ u.T
                placed[index] = True
                progress = True
        return placed

    def _rays_of(self, index: int, px: np.ndarray, py: np.ndarray, per_radian: float) -> np.ndarray:
        """Directions in the pan's frame of export points on a placed piece."""
        one = self._placed[index]
        a, b, _ = self._local(index, px, py)
        if one.piece.stitched:
            return self._stitched_rays(index, a, b)
        assert one.rotation is not None
        return self._camera_rays(index, a, b, self._focal(index, per_radian)) @ one.rotation.T

    def rays(self, px: np.ndarray, py: np.ndarray, per_radian: float) -> np.ndarray:
        """Directions in the pan's frame of export points, NaN where no placed piece lies."""
        px = np.asarray(px, dtype=np.float64)
        py = np.asarray(py, dtype=np.float64)
        placed = self.place(per_radian)
        where = self.locate(px, py)
        out = np.full((px.size, 3), np.nan)
        for index in np.unique(where):
            if index < 0 or not placed[index]:
                continue
            on = where == index
            out[on] = self._rays_of(int(index), px[on], py[on], per_radian)
        return out


def basis(rays: np.ndarray, up: np.ndarray | None = None) -> np.ndarray:
    """A virtual camera looking along the middle of the pan, level about `up` (the pan frame's own when
    None): rows right, down, forward."""
    down = -(np.array([0.0, -1.0, 0.0]) if up is None else np.asarray(up, dtype=np.float64))
    down /= np.linalg.norm(down) or 1.0
    seen = np.all(np.isfinite(rays), axis=1)
    middle = rays[seen].mean(axis=0) if seen.any() else np.array([0.0, 0.0, 1.0])
    forward = middle - (middle @ down) * down
    forward /= np.linalg.norm(forward) or 1.0
    return np.stack([np.cross(down, forward), down, forward])


def plane(rays: np.ndarray, camera: np.ndarray, lens: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Directions read through the virtual camera (`basis`) as a lens of `lens` degrees sees them:
    picture-plane points as engine/skymatch.py takes them (x right, y up, in half widths), and
    which directions it can read (those not too far to its side)."""
    local = rays @ camera.T
    seen = np.all(np.isfinite(rays), axis=1)
    readable = seen & (local[:, 2] > math.cos(math.radians(SIDE_MAX)))
    half = math.tan(math.radians(lens) / 2)
    with np.errstate(divide="ignore", invalid="ignore"):
        x = np.where(readable, local[:, 0] / local[:, 2] / half, np.nan)
        y = np.where(readable, -local[:, 1] / local[:, 2] / half, np.nan)
    return x, y, readable


@dataclass(frozen=True)
class Reading:
    """A trace drawn on a collage's export, read frame by frame through the virtual camera."""

    x: np.ndarray  # the skyline's points the frames place, on the virtual camera's plane
    y: np.ndarray
    kept: np.ndarray  # which of the skyline's points those are
    ridge_x: np.ndarray
    ridge_y: np.ndarray
    ridge_kept: np.ndarray
    lens: float  # the frames' lens across, degrees
    half_width: float  # the plane's half width in pixels, so a degree spans as many pixels as on the export
    # the export laid as a panorama about the virtual camera: its middle's heading from the camera's, and its width
    middle: float
    span: float


def strip(model: Model, camera: np.ndarray | None, export: tuple[float, float], lens: float) -> tuple[float, float]:
    """The export laid as a panorama: its middle's heading from the virtual camera's, and how many
    degrees it spans, read along its middle row."""
    width, height = export
    row = np.linspace(0.0, width, 101)
    rays = model.rays(row, np.full(row.size, height / 2), model.per_radian or 1.0)
    camera = basis(rays, model.up()) if camera is None else camera
    across = rays @ camera.T
    held = np.all(np.isfinite(across), axis=1)
    if held.sum() < 2:
        return 0.0, lens
    azimuth = np.degrees(np.unwrap(np.arctan2(across[held, 0], across[held, 2])))
    return float(np.interp(width / 2, row[held], azimuth)), float(azimuth.max() - azimuth.min())


def lens_of(model: Model) -> float | None:
    """The lens across one frame the stitch says, degrees; None when no frame was stitched."""
    if not model.per_radian:
        return None
    piece = next(p for p in model.pieces if p.stitched)
    focal = model.per_radian / piece.scale()
    return 2 * math.degrees(math.atan((piece.source[0] / 2) / focal))


def read(
    model: Model, x: np.ndarray, y: np.ndarray, ridge_x: np.ndarray, ridge_y: np.ndarray,
    export: tuple[float, float], plane_width: float = 1200.0,
) -> Reading | None:
    """A trace on the export's picture plane (x right, y up, in half its width, its middle the
    export's) read frame by frame; None when no frame was stitched to give the lens."""
    lens = lens_of(model)
    if lens is None or model.per_radian is None:
        return None
    width, height = export

    def pixels(px: np.ndarray, py: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        return (np.asarray(px, dtype=np.float64) + 1) * width / 2, height / 2 - np.asarray(py, dtype=np.float64) * width / 2

    rays = model.rays(*pixels(x, y), model.per_radian)
    camera = basis(rays, model.up())
    sx, sy, kept = plane(rays, camera, lens)
    if ridge_x.size:
        rx, ry, ridge_kept = plane(model.rays(*pixels(ridge_x, ridge_y), model.per_radian), camera, lens)
    else:
        rx, ry, ridge_kept = np.empty(0), np.empty(0), np.zeros(0, dtype=bool)
    middle, span = strip(model, camera, export, lens)
    return Reading(
        x=sx[kept], y=sy[kept], kept=kept, ridge_x=rx[ridge_kept], ridge_y=ry[ridge_kept], ridge_kept=ridge_kept,
        lens=lens, half_width=model.per_radian * plane_width / width * math.tan(math.radians(lens) / 2),
        middle=middle, span=span,
    )


def pieces_of(spec: dict[str, Any], sources: dict[str, tuple[float, float]]) -> list[Piece]:
    """The frames of a Collage document, laid on its export (the canvas trimmed to its pieces).

    `sources` gives each video's frame size by its path; a piece whose source size
    is unknown is left out."""
    nodes = [n for n in spec.get("nodes") or [] if isinstance(n, dict) and isinstance(n.get("quad"), list)]
    if not nodes:
        return []
    xs = [float(x) for n in nodes for x, _ in n["quad"]]
    ys = [float(y) for n in nodes for _, y in n["quad"]]
    x0, y0 = min(xs), min(ys)
    out = []
    for node in nodes:
        save = node.get("save") or {}
        source = sources.get(str(save.get("path") or ""))
        if not source or len(node["quad"]) != 4:
            continue
        crop = node.get("crop") or {}
        remap = None
        for op in [*(save.get("ops") or []), *(node.get("frameOps") or [])]:
            params = op.get("params") if isinstance(op, dict) and op.get("op") == "remap" else None
            if isinstance(params, dict) and len(params.get("r") or []) == 9:
                remap = params
                break
        out.append(Piece(
            quad=np.array([[float(x) - x0, float(y) - y0] for x, y in node["quad"]], dtype=np.float64),
            size=(float(node.get("w") or 0), float(node.get("h") or 0)),
            crop=(float(crop.get("x", 0)), float(crop.get("y", 0)), float(crop.get("w", 1)), float(crop.get("h", 1))),
            source=source,
            remap=remap,
        ))
    return [p for p in out if p.size[0] > 0 and p.size[1] > 0]
