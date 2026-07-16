"""Auto-stitch: solve a collage layout from overlapping imagery (spec § v2 Panorama).

The hand-made collage lets an analyst drag and warp pieces into a panorama by eye
(``engine/inspect.compose_perspective``). This module does the same job by machine
— *but it deliberately stops at the layout*. It returns each piece's quad rather
than a flattened panorama, so the result drops straight back onto the collage
canvas as ordinary pieces: still draggable, still warpable, still exported by the
same compositor. Machine stitch first, hand-tune after.

The pipeline is the classic one:

1. Detect + describe features per image, match every pair (Lowe ratio test).
2. ``findHomography(..., RANSAC)`` per pair that matches well enough — the edges
   of a match graph, weighted by inlier count.
3. Chain homographies from the best-connected image (the anchor) outward, so
   every reachable image lands in the anchor's plane. Unreachable images are
   *dropped*, never guessed at: the caller hand-places them.
4. Project each image's corners through its homography → a quad; fit the whole
   constellation into the canvas.

Only step 1-3 need OpenCV; the fitting math is pure so it stays testable and
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
            Image.BILINEAR,
        )
    kp, desc = det.detectAndCompute(np.asarray(gray), None)
    if desc is None or len(kp) < 4:
        return None, None
    return np.float32([k.pt for k in kp]) / scale, desc


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
    src = np.float32([pts_b[m.queryIdx] for m in good]).reshape(-1, 1, 2)
    dst = np.float32([pts_a[m.trainIdx] for m in good]).reshape(-1, 1, 2)
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
    corners = np.float32([[0, 0], [w, 0], [w, h], [0, h]]).reshape(-1, 1, 2)
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
            "auto-stitch found no overlap between these pieces — do they show the same scene?"
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
