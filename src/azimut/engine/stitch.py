"""Auto-stitch: solve a collage layout from overlapping imagery (spec § v2 Panorama).

The hand-made collage lets an analyst drag and warp pieces into a panorama by eye
(``engine/inspect.compose_perspective``). This module does the same job by machine
— *but it deliberately stops at the layout*. It returns each piece's geometry
rather than a flattened panorama, so the result drops straight back onto the
collage canvas as ordinary pieces: still draggable, still exported by the same
compositor. Machine stitch first, hand-tune after.

Two projection models, because one cannot serve both jobs (:func:`solve_layout`
and :func:`solve_rotation_layout`):

**Planar** assumes the pieces show one flat surface — a facade, the ground, a map.
Homographies chain from the best-connected image (the anchor) outward and every
piece lands in the anchor's *plane*, so a piece stays an ordinary 4-point quad the
analyst can keep warping by hand. The catch is that a panning camera is a rotation,
not a plane: re-expressing it as one divides every piece by ``cos(angle)`` from the
anchor, so pieces blow up towards the edges and run to infinity at 90°.

**Rotation** (cylindrical / spherical) is the model for a camera that turns. It
solves a rotation + focal length per piece, refines them all together (bundle
adjustment, so pairwise error can't accumulate into a banana), and projects onto a
cylinder or a sphere — which unrolls to a *bounded* strip however far the camera
pans, keeping verticals vertical and pieces the same size end to end. The price is
that a curved warp is not a quad: the piece's pixels are remapped (a ``remap`` op
baked into its recipe, so the full-res export re-derives it) and the piece is
placed as an upright rectangle. It stays draggable — it is no longer corner-warpable.

The heavy lifting is OpenCV's; the fitting math is pure so it stays testable and
honest about coordinates.
"""

from __future__ import annotations

from collections import deque
from typing import Any

from PIL import Image

# A pair needs this many RANSAC inliers before we believe the homography. Four
# points *define* one, so anything near that fits noise perfectly and means
# nothing — insist on real agreement instead. Measured on unrelated imagery,
# RANSAC bottoms out around 8 inliers at a ~0.27 inlier ratio, while genuine
# overlap sits far above both (160+ inliers, ~0.9); these thresholds run down the
# middle of that gap. A false stitch is worse than no stitch: it silently invents
# geometry the analyst may then reason about.
MIN_INLIERS = 20
MIN_INLIER_RATIO = 0.5

# Features are detected on a downscaled copy (speed), then keypoints are scaled
# back so every homography stays in full-resolution image coordinates.
WORK_DIM = 1000

_RATIO = 0.75  # Lowe ratio test
_RANSAC_PX = 4.0

# The rotation model's projections. "planar" is the other solver's model and is
# deliberately absent: it needs no remap, because a plane projection *is* a quad.
WARPS = ("cylindrical", "spherical")

# OpenCV scores a pair as ``inliers / (8 + 0.3 * matches)`` and calls 1.0 confident.
# Same bet as MIN_INLIERS above: a false stitch invents geometry an analyst may
# then reason about, so refuse the pair rather than guess at it.
STITCH_CONF = 1.0
_MATCH_CONF = 0.3  # per-descriptor, OpenCV's default for its panorama pipeline

# A cylinder/sphere projection roughly *preserves* a piece's area however far it
# sits from the anchor — that is the whole point of it. So a piece that lands
# wildly bigger than it started has a broken camera behind it, not a wide angle.
_MAX_WARP_AREA = 25.0

# Gain read-back probe level: mid-grey, so a gain up to ~2.5 stays representable
# in uint8 while quantisation keeps the recovered scalar within ~1%.
_PROBE = 100

Quad = list[list[float]]


def _cv2():
    """Import OpenCV lazily so the rest of Inspect works without it installed."""
    try:
        import cv2
    except ImportError as exc:  # pragma: no cover - packaging guarantees it
        raise RuntimeError(
            "auto-stitch needs OpenCV (opencv-python-headless), which is missing"
        ) from exc
    return cv2


def available() -> bool:
    """Whether auto-stitch can run at all (OpenCV importable)."""
    try:
        _cv2()
    except RuntimeError:
        return False
    return True


def _detector(cv2) -> tuple[Any, int]:
    """SIFT when present (better matches), ORB as the fallback build."""
    if hasattr(cv2, "SIFT_create"):
        return cv2.SIFT_create(nfeatures=2000), cv2.NORM_L2
    return cv2.ORB_create(nfeatures=2000), cv2.NORM_HAMMING


def _features(cv2, det, img: Image.Image):
    """Keypoints (in full-res coordinates) + descriptors, or ``(None, None)``."""
    import numpy as np

    gray = img.convert("L")
    scale = 1.0
    if max(gray.size) > WORK_DIM:
        scale = WORK_DIM / max(gray.size)
        gray = gray.resize(
            (max(1, round(gray.width * scale)), max(1, round(gray.height * scale))),
            Image.Resampling.BILINEAR,
        )
    kp, desc = det.detectAndCompute(np.asarray(gray), None)
    if desc is None or len(kp) < 4:
        return None, None
    return np.asarray([k.pt for k in kp], dtype=np.float32) / scale, desc


def _pair_homography(cv2, matcher, feat_a, feat_b) -> tuple[Any, int]:
    """Homography mapping image *b* into image *a*'s plane, + its inlier count."""
    import numpy as np

    pts_a, desc_a = feat_a
    pts_b, desc_b = feat_b
    if desc_a is None or desc_b is None:
        return None, 0
    try:
        knn = matcher.knnMatch(desc_b, desc_a, k=2)
    except Exception:  # OpenCV throws on degenerate descriptor sets
        return None, 0
    good = [m for pair in knn if len(pair) == 2 for m, n in [pair] if m.distance < _RATIO * n.distance]
    if len(good) < MIN_INLIERS:
        return None, 0
    src = np.asarray([pts_b[m.queryIdx] for m in good], dtype=np.float32).reshape(-1, 1, 2)
    dst = np.asarray([pts_a[m.trainIdx] for m in good], dtype=np.float32).reshape(-1, 1, 2)
    H, mask = cv2.findHomography(src, dst, cv2.RANSAC, _RANSAC_PX)
    if H is None or mask is None:
        return None, 0
    inliers = int(mask.sum())
    if inliers < MIN_INLIERS or inliers / len(good) < MIN_INLIER_RATIO:
        return None, 0
    return H, inliers


def _anchor_and_chain(edges: dict[tuple[int, int], Any], weights: dict[tuple[int, int], int], count: int):
    """Pick the best-connected image, then chain homographies outward from it.

    Returns ``(anchor, {index: H_to_anchor})``. Images with no path to the anchor
    are simply absent from the mapping — the caller reports them as dropped.
    """
    import numpy as np

    adjacency: dict[int, list[int]] = {i: [] for i in range(count)}
    for (i, j) in edges:
        adjacency[i].append(j)
        adjacency[j].append(i)

    # Score by total inlier weight: the image the others agree with most is the
    # most trustworthy plane to express everyone else in.
    score = {i: 0 for i in range(count)}
    for (i, j), w in weights.items():
        score[i] += w
        score[j] += w

    def component(root: int) -> set[int]:
        seen = {root}
        queue = deque([root])
        while queue:
            cur = queue.popleft()
            for nxt in adjacency[cur]:
                if nxt not in seen:
                    seen.add(nxt)
                    queue.append(nxt)
        return seen

    # Largest connected component first, best-connected node within it.
    best_component: set[int] = set()
    for i in range(count):
        comp = component(i)
        if len(comp) > len(best_component):
            best_component = comp
        if len(best_component) == count:
            break
    if not best_component:
        return 0, {}
    anchor = max(best_component, key=lambda i: score[i])

    chained: dict[int, Any] = {anchor: np.eye(3, dtype=np.float64)}
    queue = deque([anchor])
    while queue:
        cur = queue.popleft()
        for nxt in adjacency[cur]:
            if nxt in chained:
                continue
            # edges[(a, b)] maps b into a's plane; invert when we walk the other way.
            if (cur, nxt) in edges:
                step = edges[(cur, nxt)]
            else:
                step = np.linalg.inv(edges[(nxt, cur)])
            chained[nxt] = chained[cur] @ step
            queue.append(nxt)
    return anchor, chained


def _project_corners(cv2, H, size: tuple[int, int]) -> Quad:
    """The image's four corners (TL, TR, BR, BL) pushed through ``H``."""
    import numpy as np

    w, h = size
    corners = np.asarray([[0, 0], [w, 0], [w, h], [0, h]], dtype=np.float32).reshape(-1, 1, 2)
    out = cv2.perspectiveTransform(corners, H.astype(np.float64))
    return [[float(x), float(y)] for x, y in out.reshape(-1, 2)]


def quad_ok(quad: Quad) -> bool:
    """Reject degenerate projections: non-finite, collapsed, or folded quads.

    A homography chained through a bad match can send corners to infinity or turn
    the quad inside out. Such a piece is worse than useless on the canvas, so it
    is dropped rather than rendered.
    """
    import math

    if any(not math.isfinite(v) for pt in quad for v in pt):
        return False
    # Convexity: every consecutive cross product must share a sign. A fold or a
    # collapse breaks it, and a zero-area quad has no consistent sign at all.
    signs = []
    for i in range(4):
        ax, ay = quad[i]
        bx, by = quad[(i + 1) % 4]
        cx, cy = quad[(i + 2) % 4]
        cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx)
        signs.append(cross)
    if any(abs(s) < 1e-6 for s in signs):
        return False
    return all(s > 0 for s in signs) or all(s < 0 for s in signs)


def fit_quads_to_canvas(
    quads: list[Quad], width: int, height: int, *, margin: float = 0.02
) -> list[Quad]:
    """Translate + uniformly scale ``quads`` to sit inside ``width × height``.

    Uniform (never per-axis) so the solved geometry keeps its proportions, and
    centred, with a small margin so edge pieces stay grabbable.
    """
    if not quads:
        return []
    xs = [p[0] for q in quads for p in q]
    ys = [p[1] for q in quads for p in q]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    span_x = max(max_x - min_x, 1e-6)
    span_y = max(max_y - min_y, 1e-6)
    usable = 1.0 - 2.0 * margin
    scale = min(width * usable / span_x, height * usable / span_y)
    off_x = (width - span_x * scale) / 2.0 - min_x * scale
    off_y = (height - span_y * scale) / 2.0 - min_y * scale
    return [[[x * scale + off_x, y * scale + off_y] for x, y in q] for q in quads]


def solve_layout(images: list[Image.Image], *, width: int, height: int) -> dict[str, Any]:
    """Solve collage quads for ``images`` (canvas pixels), reporting what failed.

    Returns ``{"quads": {index: quad}, "dropped": [index, ...], "anchor": index}``.
    ``dropped`` holds images that matched nothing (or projected degenerately) —
    they keep whatever the caller had; nothing is invented for them.
    """
    if len(images) < 2:
        raise ValueError("auto-stitch needs at least two pieces")

    cv2 = _cv2()
    det, norm = _detector(cv2)
    matcher = cv2.BFMatcher(norm)

    feats = [_features(cv2, det, img) for img in images]

    edges: dict[tuple[int, int], Any] = {}
    weights: dict[tuple[int, int], int] = {}
    for i in range(len(images)):
        for j in range(i + 1, len(images)):
            H, inliers = _pair_homography(cv2, matcher, feats[i], feats[j])
            if H is not None:
                edges[(i, j)] = H
                weights[(i, j)] = inliers

    if not edges:
        raise RuntimeError(
            "auto-stitch found no overlap between these pieces. Do they show the same scene?"
        )

    anchor, chained = _anchor_and_chain(edges, weights, len(images))

    solved: dict[int, Quad] = {}
    dropped: list[int] = []
    for idx, img in enumerate(images):
        H = chained.get(idx)
        if H is None:
            dropped.append(idx)
            continue
        quad = _project_corners(cv2, H, img.size)
        if not quad_ok(quad):
            dropped.append(idx)
            continue
        solved[idx] = quad

    if not solved:
        raise RuntimeError("auto-stitch could not place any piece")

    order = sorted(solved)
    fitted = fit_quads_to_canvas([solved[i] for i in order], width, height)
    return {
        "quads": {i: q for i, q in zip(order, fitted)},
        "dropped": sorted(dropped),
        "anchor": anchor,
    }


# ---------------------------------------------------------------------------
# Rotation model — the panorama projections (cylindrical / spherical)
# ---------------------------------------------------------------------------


def _work_array(img: Image.Image):
    """The image as an RGB array, downscaled to ``WORK_DIM`` for speed.

    Every camera this module solves is therefore expressed in *work* pixels. That
    is not a rounding error to correct later: intrinsics scale with the image, so
    the params are stored as fractions of the work width and multiply straight back
    up at export time (:func:`apply_warp`).
    """
    import numpy as np

    rgb = img.convert("RGB")
    if max(rgb.size) > WORK_DIM:
        scale = WORK_DIM / max(rgb.size)
        rgb = rgb.resize(
            (max(1, round(rgb.width * scale)), max(1, round(rgb.height * scale))),
            Image.Resampling.BILINEAR,
        )
    return np.asarray(rgb)


def _detail_features(cv2, arrays: list[Any]) -> list[Any]:
    det, _ = _detector(cv2)
    return [cv2.detail.computeImageFeatures2(det, arr) for arr in arrays]


def _match_component(cv2, feats: list[Any]) -> tuple[list[Any], list[int]]:
    """Match every pair, then return the matches + the biggest agreeing group.

    Pieces outside that group are not stitched to anything we trust, so the caller
    leaves them exactly where the analyst put them.
    """
    matcher = cv2.detail.BestOf2NearestMatcher_create(False, _MATCH_CONF)
    pairwise = matcher.apply2(feats)
    matcher.collectGarbage()

    adjacency: dict[int, list[int]] = {i: [] for i in range(len(feats))}
    for m in pairwise:
        if m.src_img_idx < 0 or m.dst_img_idx < 0 or m.H is None:
            continue
        if m.confidence < STITCH_CONF:
            continue
        adjacency[m.src_img_idx].append(m.dst_img_idx)
        adjacency[m.dst_img_idx].append(m.src_img_idx)

    best: set[int] = set()
    seen: set[int] = set()
    for i in range(len(feats)):
        if i in seen:
            continue
        comp = {i}
        queue = deque([i])
        while queue:
            cur = queue.popleft()
            for nxt in adjacency[cur]:
                if nxt not in comp:
                    comp.add(nxt)
                    queue.append(nxt)
        seen |= comp
        if len(comp) > len(best):
            best = comp
    return pairwise, sorted(best)


def _solve_cameras(cv2, feats: list[Any], pairwise: list[Any]) -> list[Any]:
    """A rotation + focal per image, refined against every match at once.

    The estimator seeds the cameras from the pairwise homographies; the ray-space
    bundle adjuster is what keeps a long pan from drifting, since it answers to all
    the matches jointly rather than to one chain of pairs.
    """
    import numpy as np

    ok, cameras = cv2.detail_HomographyBasedEstimator().apply(feats, pairwise, None)
    if not ok:
        raise RuntimeError("auto-stitch could not estimate the camera rotations")
    for cam in cameras:
        cam.R = cam.R.astype(np.float32)

    adjuster = cv2.detail_BundleAdjusterRay()
    adjuster.setConfThresh(STITCH_CONF)
    adjuster.setRefinementMask(np.ones((3, 3), np.uint8))
    ok, cameras = adjuster.apply(feats, pairwise, cameras)
    if not ok:
        raise RuntimeError("auto-stitch could not refine the camera rotations")

    # Wave correction pulls the panorama's horizon back level: chained rotations
    # are free to roll as a group, and a whole-strip tilt reads as a "banana".
    try:
        rmats = [np.copy(cam.R) for cam in cameras]
        for cam, R in zip(cameras, cv2.detail.waveCorrect(rmats, cv2.detail.WAVE_CORRECT_HORIZ)):
            cam.R = R
    except cv2.error:
        pass  # too few / too parallel views to define a horizon; leave them be
    return cameras


def _median(values: list[float]) -> float:
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2.0


def _gains(cv2, warper, warped: list[Any], masks: list[Any], corners: list[Any]) -> list[float]:
    """One exposure scalar per piece, so neighbours stop stepping in brightness.

    OpenCV solves the classic overlap-mean system but its Python binding exposes
    only ``apply`` (which multiplies an image in place), not the gains themselves —
    so each scalar is read back by applying it to a flat probe patch, where
    ``out / in`` *is* the gain. Falls back to 1.0 (no correction) rather than
    failing the stitch: a brightness step is a blemish, not a wrong answer.
    """
    import numpy as np

    compensator = cv2.detail_GainCompensator()
    try:
        compensator.feed(corners, warped, masks)
    except cv2.error:
        return [1.0] * len(warped)

    probe = np.full((4, 4, 3), _PROBE, np.uint8)
    probe_mask = np.full((4, 4), 255, np.uint8)
    out: list[float] = []
    for i, corner in enumerate(corners):
        try:
            got = compensator.apply(i, corner, probe.copy(), probe_mask)
        except cv2.error:
            out.append(1.0)
            continue
        out.append(float(np.mean(got)) / _PROBE)
    return out


def _remap_params(warp: str, cam: Any, scale: float, size: tuple[int, int], gain: float) -> dict[str, Any]:
    """The piece's warp, as a recipe op — resolution-independent by construction.

    Lengths are stored as fractions of the *work* image the camera was solved on,
    so re-deriving at full res just multiplies them back up: same shape, more
    pixels. The compositor then fits that shape into the piece's quad, which is why
    each piece may normalise against its own width without breaking the shared
    warp space.
    """
    import numpy as np

    w, h = size
    return {
        "warp": warp,
        "focal": float(cam.focal) / w,
        "aspect": float(cam.aspect),
        "ppx": float(cam.ppx) / w,
        "ppy": float(cam.ppy) / h,
        "r": [float(v) for v in np.asarray(cam.R, dtype=float).reshape(9)],
        "scale": float(scale) / w,
        "gain": round(float(gain), 4),
    }


def _camera_at(params: dict[str, Any], width: int, height: int):
    """Rebuild ``(K, R, scale)`` from a stored remap op, at this image's size."""
    import numpy as np

    focal = float(params["focal"]) * width
    aspect = float(params.get("aspect", 1.0))
    K = np.array(
        [
            [focal, 0.0, float(params["ppx"]) * width],
            [0.0, focal * aspect, float(params["ppy"]) * height],
            [0.0, 0.0, 1.0],
        ],
        dtype=np.float32,
    )
    R = np.asarray(params["r"], dtype=np.float32).reshape(3, 3)
    return K, R, float(params["scale"]) * width


def apply_warp(img: Image.Image, params: dict[str, Any]) -> Image.Image:
    """Remap one piece onto the cylinder/sphere the solver picked → RGBA.

    Alpha marks the warped footprint: the projection is curved, so the corners of
    the output rectangle fall outside the piece and must stay transparent rather
    than paint black wedges over its neighbours.
    """
    import numpy as np

    warp = str(params.get("warp") or "")
    if warp not in WARPS:
        raise ValueError(f"unknown panorama warp {warp!r}")
    cv2 = _cv2()

    src = np.asarray(img.convert("RGB"))
    height, width = src.shape[:2]
    K, R, scale = _camera_at(params, width, height)
    warper = cv2.PyRotationWarper(warp, scale)
    _, warped = warper.warp(src, K, R, cv2.INTER_LINEAR, cv2.BORDER_CONSTANT)
    _, mask = warper.warp(
        np.full((height, width), 255, np.uint8), K, R, cv2.INTER_NEAREST, cv2.BORDER_CONSTANT
    )

    gain = float(params.get("gain", 1.0))
    if gain != 1.0:
        warped = np.clip(warped.astype(np.float32) * gain, 0, 255).astype(np.uint8)

    out = Image.fromarray(warped, "RGB").convert("RGBA")
    out.putalpha(Image.fromarray(mask, "L"))
    return out


def solve_rotation_layout(
    images: list[Image.Image], *, width: int, height: int, warp: str = "cylindrical"
) -> dict[str, Any]:
    """Solve a panorama layout under the rotation model — geometry *and* a remap.

    Returns ``{"quads": {index: quad}, "remaps": {index: params}, "dropped": [...]}``.
    Each quad is the upright rectangle the piece's remapped pixels fill, in canvas
    pixels; each remap is the op that produces those pixels from the piece's
    recipe. ``dropped`` holds the pieces no trusted match reached — the caller
    leaves them untouched, exactly as in :func:`solve_layout`.
    """
    import numpy as np

    if len(images) < 2:
        raise ValueError("auto-stitch needs at least two pieces")
    if warp not in WARPS:
        raise ValueError(f"unknown panorama warp {warp!r}")

    cv2 = _cv2()
    arrays = [_work_array(img) for img in images]
    feats = _detail_features(cv2, arrays)

    pairwise, keep = _match_component(cv2, feats)
    if len(keep) < 2:
        raise RuntimeError(
            "auto-stitch found no overlap between these pieces. Do they show the same scene?"
        )
    if len(keep) < len(images):
        # Re-match on the subset alone: the estimator indexes cameras by position
        # in the features it is handed, so the group has to be re-numbered first.
        feats = [feats[i] for i in keep]
        pairwise, _ = _match_component(cv2, feats)

    cameras = _solve_cameras(cv2, feats, pairwise)
    scale = _median([float(cam.focal) for cam in cameras])
    warper = cv2.PyRotationWarper(warp, scale)

    corners, warped, masks = [], [], []
    for pos, idx in enumerate(keep):
        cam = cameras[pos]
        K = cam.K().astype("float32")
        src = arrays[idx]
        corner, img_w = warper.warp(src, K, cam.R, cv2.INTER_LINEAR, cv2.BORDER_CONSTANT)
        _, mask_w = warper.warp(
            np.full(src.shape[:2], 255, np.uint8), K, cam.R, cv2.INTER_NEAREST, cv2.BORDER_CONSTANT
        )
        corners.append(corner)
        warped.append(img_w)
        masks.append(mask_w)

    gains = _gains(cv2, warper, warped, masks, corners)

    quads: dict[int, Quad] = {}
    remaps: dict[int, dict[str, Any]] = {}
    dropped = [i for i in range(len(images)) if i not in set(keep)]
    for pos, idx in enumerate(keep):
        src_h, src_w = arrays[idx].shape[:2]
        out_h, out_w = warped[pos].shape[:2]
        x, y = float(corners[pos][0]), float(corners[pos][1])
        quad = [[x, y], [x + out_w, y], [x + out_w, y + out_h], [x, y + out_h]]
        if not quad_ok(quad) or (out_w * out_h) > _MAX_WARP_AREA * src_w * src_h:
            dropped.append(idx)
            continue
        quads[idx] = quad
        remaps[idx] = _remap_params(warp, cameras[pos], scale, (src_w, src_h), gains[pos])

    if not quads:
        raise RuntimeError("auto-stitch could not place any piece")

    order = sorted(quads)
    fitted = fit_quads_to_canvas([quads[i] for i in order], width, height)
    return {
        "quads": {i: q for i, q in zip(order, fitted)},
        "remaps": remaps,
        "dropped": sorted(dropped),
    }
