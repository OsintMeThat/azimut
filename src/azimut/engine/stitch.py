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

Both models share one pre-filter (:func:`_static_points`): keypoints that sit at
the same pixel of most pieces are dropped before any matching. Video frames come
with burnt-in furniture — a platform logo, a channel bug — and those points agree
with each other far too well to be argued with once they reach the matcher. What
moves through the scene instead (a passer-by, a car) or what the filter cannot
see (a caption that changes) the analyst paints out: :func:`exclusion_mask` turns
those strokes into a mask the detector honours, so nothing under them is matched.

Frames of one video are matched along their time (:func:`near_pairs`) rather than
all against all, falling back to every pair whenever that leaves a piece out.
Every solve seeds OpenCV's random generator first, so the same pieces give the
same answer however many stitches ran before.

The heavy lifting is OpenCV's; the fitting math is pure so it stays testable and
honest about coordinates.
"""

from __future__ import annotations

import math
from collections import defaultdict, deque
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

# A solved layout comes out in source pixels — five 1080p frames panned across a
# facade span some 4500 of them — so the canvas follows the stitch rather than
# the other way round. Fitting that answer into whatever size the collage
# happened to open at is a downscale, and thin detail (a cable, a pipe) is what
# goes first. Bounded, because the canvas still has to be composable: the compose
# route refuses a side over 8192, and the compositor paints RGBA, so 40 MP is
# already a 160 MB canvas before a single piece is warped onto it.
MAX_CANVAS_DIM = 8192
MAX_CANVAS_PIXELS = 40_000_000

_RATIO = 0.75  # Lowe ratio test
# Reprojection tolerance in *work* pixels, the grid keypoints are found on. In
# full-resolution pixels it shrank with the picture: a 6000 px photo allowed under
# one work pixel, and a lens's barrel was enough to refuse a true pair.
_RANSAC_PX = 4.0

# SIFT keeps its 2000 strongest points above a contrast floor. OpenCV's floor
# (0.04) leaves a hazy, misty or flat-coloured picture with a few dozen points, or
# none, and the stitch then says the pieces do not overlap (measured: a cloudy sky
# band 0–32, a flat illustration 5–90, where ordinary video frames hold 145–490).
# Such a picture is looked at again with a lower floor, keeping its 500 strongest:
# enough to match, and bounded, because every point is paid for again in the
# camera solve, which grew sixfold when such frames kept 2000.
_CONTRAST = 0.04
_CONTRAST_LOW = 0.01
_FEW_POINTS = 150
_LOW_POINTS = 500

# OpenCV's matcher draws on its global random generator, which every earlier
# stitch has moved on: seeded first, the same pieces always solve the same way.
# 0 is the state a fresh process starts in.
_SEED = 0

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

# Frames pulled from one video carry the same burnt-in furniture — a platform logo,
# a channel bug, a timestamp — at the same pixel of every frame. Those keypoints
# match each other perfectly at zero displacement, and being both numerous and
# mutually consistent they out-vote the scene: RANSAC settles on the identity
# homography and the pieces stack instead of stitching. So find them and never hand
# them to the matcher. Position is the whole test — an overlay is defined by *where*
# it sits, not by what it looks like, and keypoints are sparse enough (~2000 over a
# 1000px work image) that a chance co-location surviving across most of the set is
# vanishingly unlikely.
_STATIC_PX = 2.0  # work pixels: an overlay does not move, only the detector jitters
_STATIC_SHARE = 0.6  # of the other same-sized pieces must show the point too
# Two pieces of a still camera look exactly like two pieces sharing an overlay, and
# there the identity *is* the answer — so never conclude anything from one peer.
_STATIC_MIN_PEERS = 2
# Past this share the *scene* is what stands still (a fixed camera, a slow pan), not
# an overlay on it. Dropping those points would leave nothing to stitch with, so the
# piece keeps all of them and the solver is no worse off than before.
_STATIC_MAX_SHARE = 0.5

# Gain read-back probe level: mid-grey, so a gain up to ~2.5 stays representable
# in uint8 while quantisation keeps the recovered scalar within ~1%.
_PROBE = 100

Quad = list[list[float]]

# A stitched strip's scale is believed only when its pieces agree on it: each
# stitched piece's middle lies where its heading puts it, within this share of the
# span they cover between them. Pieces dragged by hand after the stitch break it.
STRIP_AGREE = 0.02


def _cv2():
    """Import OpenCV lazily so the rest of Inspect works without it installed."""
    try:
        import cv2
    except ImportError as exc:  # pragma: no cover - packaging guarantees it
        raise RuntimeError(
            "auto-stitch needs OpenCV (opencv-python-headless), which is missing"
        ) from exc
    return cv2


def _seeded_cv2():
    """OpenCV, its random generator reset (:data:`_SEED`) for the solve about to run.

    The generator is per thread and OpenCV's parallel loops start from the calling
    thread's state, so seeding here covers the matching it fans out.
    """
    cv2 = _cv2()
    cv2.setRNGSeed(_SEED)
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
        return cv2.SIFT_create(nfeatures=2000, contrastThreshold=_CONTRAST), cv2.NORM_L2
    return cv2.ORB_create(nfeatures=2000), cv2.NORM_HAMMING


def _low_detector(cv2):
    """The detector for a picture the first one found too little in, or None (ORB)."""
    if not hasattr(cv2, "SIFT_create"):
        return None
    return cv2.SIFT_create(nfeatures=_LOW_POINTS, contrastThreshold=_CONTRAST_LOW)


def _work_scale(size: tuple[int, int]) -> float:
    """The factor that takes an image down to ``WORK_DIM`` (1.0 if already smaller)."""
    return min(1.0, WORK_DIM / max(size))


def _work_size(size: tuple[int, int]) -> tuple[int, int]:
    """``size`` after :func:`_work_scale` — the pixel grid features are found on."""
    scale = _work_scale(size)
    return max(1, round(size[0] * scale)), max(1, round(size[1] * scale))


Strokes = list[dict[str, Any]]


def exclusion_mask(strokes: Strokes | None, size: tuple[int, int]):
    """Where the detector may look on a ``size`` picture: 255, and 0 under the strokes.

    A stroke is ``{"points": [[x, y], …], "radius": r}``, the analyst's brush on
    the piece: ``x, y`` run 0–1 across the picture the stitch receives (its ops
    applied, crop included) and ``r`` is a share of that picture's width. It
    covers a disc round every point and the band joining each to the next, so a
    drag paints a solid trail with round ends. None when nothing is painted.
    """
    import numpy as np

    if not strokes:
        return None
    cv2 = _cv2()
    width, height = size
    mask = np.full((height, width), 255, np.uint8)
    for stroke in strokes:
        radius = max(1, round(float(stroke["radius"]) * width))
        points = [(round(float(x) * width), round(float(y) * height)) for x, y in stroke["points"]]
        for point in points:
            cv2.circle(mask, point, radius, 0, -1)
        for start, end in zip(points, points[1:]):
            cv2.line(mask, start, end, 0, 2 * radius + 1)
    return mask


def _strokes_of(exclude: list[Strokes | None] | None, count: int) -> list[Strokes | None]:
    """``exclude`` as one entry per piece, absent read as nothing painted."""
    if exclude is None:
        return [None] * count
    if len(exclude) != count:
        raise ValueError("exclude needs one entry per piece")
    return list(exclude)


def _features(cv2, det, img: Image.Image, strokes: Strokes | None = None, low=None):
    """Keypoints (in full-res coordinates) + descriptors, or ``(None, None)``.

    ``strokes`` are the areas painted out of the piece (:func:`exclusion_mask`):
    the detector never looks there, so no point under them reaches the matcher.
    ``low`` is the detector to look again with when ``det`` finds fewer than
    :data:`_FEW_POINTS`.
    """
    import numpy as np

    gray = img.convert("L")
    scale = _work_scale(gray.size)
    if scale < 1.0:
        gray = gray.resize(_work_size(gray.size), Image.Resampling.BILINEAR)
    mask = exclusion_mask(strokes, gray.size)
    if mask is not None and not mask.any():
        return None, None
    pixels = np.asarray(gray)
    kp, desc = det.detectAndCompute(pixels, mask)
    if low is not None and len(kp) < _FEW_POINTS:
        kp, desc = low.detectAndCompute(pixels, mask)
    if desc is None or len(kp) < 4:
        return None, None
    return np.asarray([k.pt for k in kp], dtype=np.float32) / scale, desc


# A frame of a video overlaps the frames filmed just before and after it, rarely the
# ones far off. So frames of one video meet their neighbours in time and a few skips
# (a frame lost to blur or a passer-by is bridged), and the pairs grow with the count
# of frames rather than with its square.
_NEAR_STEPS = (1, 2, 4)


def near_pairs(
    sources: list[tuple[str, float | None]] | None, count: int
) -> list[tuple[int, int]] | None:
    """The pairs ``(i, j)``, ``i < j``, worth matching first; None for every pair.

    ``sources`` gives each piece's ``(path, time)``. Pieces sharing a path with a
    time set are frames of one video, and pair only with the frames
    :data:`_NEAR_STEPS` apart in time. Everything else, a picture or a frame of
    another video, pairs with every piece, since nothing says where it overlaps.
    None when that leaves every pair anyway.
    """
    if not sources or len(sources) != count:
        return None
    videos: dict[str, list[int]] = defaultdict(list)
    for i, (path, time) in enumerate(sources):
        if time is not None:
            videos[path].append(i)
    video_of: dict[int, str] = {}
    pairs: set[tuple[int, int]] = set()
    for path, frames in videos.items():
        if len(frames) < 2:
            continue
        frames.sort(key=lambda i: (sources[i][1], i))
        for rank, i in enumerate(frames):
            video_of[i] = path
            for step in _NEAR_STEPS:
                if rank + step < len(frames):
                    j = frames[rank + step]
                    pairs.add((min(i, j), max(i, j)))
    for i in range(count):
        for j in range(i + 1, count):
            if i not in video_of or video_of.get(i) != video_of.get(j):
                pairs.add((i, j))
    if len(pairs) == count * (count - 1) // 2:
        return None
    return sorted(pairs)


def _all_pairs(count: int) -> list[tuple[int, int]]:
    return [(i, j) for i in range(count) for j in range(i + 1, count)]


def _static_points(points: list[Any], sizes: list[tuple[int, int]]) -> list[set[int]]:
    """Per image, the indices of the keypoints that sit still across the set.

    ``points`` are keypoints in *work* pixels (so the tolerance means the same thing
    whatever the source resolution) and ``sizes`` the work sizes they were found on.
    Only pieces of identical size are compared: an overlay lands on the same pixel
    of every frame of one video, and that claim is meaningless across geometries.

    A keypoint is called static when enough of its peers hold one within
    :data:`_STATIC_PX` of the same spot. The two guards above — a floor on peers, a
    ceiling on the share — draw the line between "something is pinned over the
    scene" and "the scene itself is not moving", which the evidence inside a single
    piece cannot tell apart.
    """
    out: list[set[int]] = [set() for _ in points]
    groups: dict[tuple[int, int], list[int]] = defaultdict(list)
    for i, (pts, size) in enumerate(zip(points, sizes)):
        if pts is not None and len(pts):
            groups[size].append(i)

    for members in groups.values():
        if len(members) <= _STATIC_MIN_PEERS:
            continue
        # Bucket every keypoint into a _STATIC_PX-wide cell, so a point's possible
        # neighbours are the nine cells around its own — no all-pairs scan.
        cells: dict[tuple[int, int], list[tuple[int, int]]] = defaultdict(list)
        for i in members:
            for k, (x, y) in enumerate(points[i]):
                cells[(int(x // _STATIC_PX), int(y // _STATIC_PX))].append((i, k))

        needed = max(_STATIC_MIN_PEERS, math.ceil(_STATIC_SHARE * (len(members) - 1)))
        for i in members:
            flagged: set[int] = set()
            for k, (x, y) in enumerate(points[i]):
                cx, cy = int(x // _STATIC_PX), int(y // _STATIC_PX)
                peers: set[int] = set()
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        for j, m in cells.get((cx + dx, cy + dy), ()):
                            if j == i or j in peers:
                                continue
                            px, py = points[j][m]
                            if (px - x) ** 2 + (py - y) ** 2 <= _STATIC_PX**2:
                                peers.add(j)
                if len(peers) >= needed:
                    flagged.add(k)
            if len(flagged) <= _STATIC_MAX_SHARE * len(points[i]):
                out[i] = flagged
    return out


def _drop_points(feat, drop: set[int]):
    """``feat`` minus the given keypoints, or ``(None, None)`` if too few remain."""
    pts, desc = feat
    if pts is None or not drop:
        return feat
    keep = [k for k in range(len(pts)) if k not in drop]
    if len(keep) < 4:
        return None, None
    return pts[keep], desc[keep]


def _pair_homography(cv2, matcher, feat_a, feat_b, ransac_px: float = _RANSAC_PX) -> tuple[Any, int]:
    """Homography mapping image *b* into image *a*'s plane, + its inlier count.

    ``ransac_px`` is the reprojection tolerance in *a*'s full-resolution pixels
    (:data:`_RANSAC_PX` work pixels, scaled up by the caller).
    """
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
    # One point of *a* answers one point of *b*, the closest. Left many-to-one, a
    # picture with a few dozen points soaks up hundreds of matches from a busy one,
    # and a homography folding the busy one onto those few "agrees" with them all:
    # two unrelated pictures (a sky and a mountain) passed every guard that way.
    closest: dict[int, Any] = {}
    for m in good:
        kept = closest.get(m.trainIdx)
        if kept is None or m.distance < kept.distance:
            closest[m.trainIdx] = m
    good = list(closest.values())
    if len(good) < MIN_INLIERS:
        return None, 0
    src = np.asarray([pts_b[m.queryIdx] for m in good], dtype=np.float32).reshape(-1, 1, 2)
    dst = np.asarray([pts_a[m.trainIdx] for m in good], dtype=np.float32).reshape(-1, 1, 2)
    H, mask = cv2.findHomography(src, dst, cv2.RANSAC, ransac_px)
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


def canvas_for_layout(
    quads: list[Quad],
    *,
    detail: float = 1.0,
    minimum: tuple[int, int] = (1, 1),
    margin: float = 0.02,
) -> tuple[int, int]:
    """The canvas that holds ``quads`` without scaling their pixels down.

    ``detail`` is how many source pixels one unit of the solved geometry is worth:
    1 for the planar solver, whose homographies are already in full-resolution
    coordinates, and the work-image factor for the rotation solver, which projects
    a downscaled copy of every piece. The span is divided by the fraction
    :func:`fit_quads_to_canvas` leaves usable, so fitting into this answer scales
    the geometry by exactly one.

    The bounds above hold what the *solver* asks for, and it stays under them by
    shrinking both sides together, so a clamped canvas still carries the shape it
    found. They are not a ceiling on the canvas: ``minimum`` is the one the
    analyst is already working on, and this never answers below it — growing to
    hold a stitch must not become a way of shrinking a canvas that was already
    bigger, which would take the size off the pieces sitting on it.
    """
    if not quads:
        return max(1, minimum[0]), max(1, minimum[1])
    xs = [p[0] for q in quads for p in q]
    ys = [p[1] for q in quads for p in q]
    usable = max(1e-6, 1.0 - 2.0 * margin)
    width = max(1, math.ceil((max(xs) - min(xs)) * detail / usable))
    height = max(1, math.ceil((max(ys) - min(ys)) * detail / usable))
    shrink = min(
        1.0,
        MAX_CANVAS_DIM / max(width, height),
        math.sqrt(MAX_CANVAS_PIXELS / (width * height)),
    )
    if shrink < 1.0:
        width = max(1, int(width * shrink))
        height = max(1, int(height * shrink))
    width = max(1, minimum[0], width)
    height = max(1, minimum[1], height)
    return width, height


NO_OVERLAP = "auto-stitch found no overlap between these pieces. Do they show the same scene?"

#: Why a piece was left where it was, one word each, as the Collage tool says it: its
#: detail matched no other piece; it had too little to match at all, being blank, flat
#: or painted out; or it matched, and its projection folded, ran off to infinity or grew
#: past the bound a projection may grow by.
LEFT_NO_OVERLAP = "no-overlap"
LEFT_NO_DETAIL = "no-detail"
LEFT_OFF_CANVAS = "off-canvas"


def _why_left_out(dropped: list[int], points: list[int], off: set[int]) -> list[str]:
    """Why each piece of ``sorted(dropped)`` was left out. ``points`` is how many points
    each piece had left to match with, once its painted areas and whatever sat still
    across the set were taken out; fewer than a pair needs to be believed
    (:data:`MIN_INLIERS`) is nothing to match. ``off`` are the pieces that matched but
    projected badly."""
    return [
        LEFT_OFF_CANVAS if i in off else LEFT_NO_DETAIL if points[i] < MIN_INLIERS else LEFT_NO_OVERLAP
        for i in sorted(dropped)
    ]


def _planar_place(cv2, images: list[Image.Image], tried: dict[tuple[int, int], tuple[Any, int]]):
    """Chain the matched pairs from the anchor: ``(anchor, quads, dropped, off)``, or None
    when no pair matched, ``off`` the dropped pieces whose projection failed. Edges go
    in pair order, so every pair tried gives exactly the layout the all-pairs solver
    always gave."""
    edges: dict[tuple[int, int], Any] = {}
    weights: dict[tuple[int, int], int] = {}
    for pair in sorted(tried):
        H, inliers = tried[pair]
        if H is not None:
            edges[pair] = H
            weights[pair] = inliers
    if not edges:
        return None

    anchor, chained = _anchor_and_chain(edges, weights, len(images))
    solved: dict[int, Quad] = {}
    dropped: list[int] = []
    off: set[int] = set()
    for idx, img in enumerate(images):
        H = chained.get(idx)
        if H is None:
            dropped.append(idx)
            continue
        quad = _project_corners(cv2, H, img.size)
        if not quad_ok(quad):
            dropped.append(idx)
            off.add(idx)
            continue
        solved[idx] = quad
    return anchor, solved, dropped, off


def solve_layout(
    images: list[Image.Image],
    *,
    width: int,
    height: int,
    sources: list[tuple[str, float | None]] | None = None,
    exclude: list[Strokes | None] | None = None,
) -> dict[str, Any]:
    """Solve collage quads for ``images`` (canvas pixels), reporting what failed.

    Returns ``{"quads": {index: quad}, "dropped": [...], "why": [...], "anchor": index,
    "canvas": {"width", "height"}}``. ``dropped`` holds images that matched
    nothing (or projected degenerately) — they keep whatever the caller had;
    nothing is invented for them. ``why`` says, for each in ``dropped``, which of
    the three it was (:data:`LEFT_NO_OVERLAP`, :data:`LEFT_NO_DETAIL`,
    :data:`LEFT_OFF_CANVAS`).

    ``width`` and ``height`` are the canvas the caller already has, and the answer
    is fitted into the larger of that and the layout's own extent
    (:func:`canvas_for_layout`) — so a wide pan of full-resolution frames is not
    squeezed into a small canvas, which is a downscale of the very detail it was
    stitched for. ``canvas`` reports the size the quads are expressed in.

    ``sources`` (each piece's ``(path, time)``) lets frames of one video match
    their neighbours in time first (:func:`near_pairs`); when that leaves any
    piece out, every pair is matched as it always was. ``exclude`` holds each
    piece's painted strokes, or None (:func:`exclusion_mask`).
    """
    if len(images) < 2:
        raise ValueError("auto-stitch needs at least two pieces")
    strokes = _strokes_of(exclude, len(images))

    cv2 = _seeded_cv2()
    det, norm = _detector(cv2)
    low = _low_detector(cv2)
    matcher = cv2.BFMatcher(norm)

    feats = [_features(cv2, det, img, marks, low) for img, marks in zip(images, strokes)]
    statics = _static_points(
        [
            None if pts is None else pts * _work_scale(img.size)
            for (pts, _), img in zip(feats, images)
        ],
        [_work_size(img.size) for img in images],
    )
    feats = [_drop_points(f, s) for f, s in zip(feats, statics)]
    tolerance = [_RANSAC_PX / _work_scale(img.size) for img in images]

    tried: dict[tuple[int, int], tuple[Any, int]] = {}

    def match(pairs: list[tuple[int, int]]) -> None:
        for i, j in pairs:
            if (i, j) not in tried:
                tried[(i, j)] = _pair_homography(cv2, matcher, feats[i], feats[j], tolerance[i])

    placed = None
    near = near_pairs(sources, len(images))
    if near is not None:
        match(near)
        placed = _planar_place(cv2, images, tried)
        if placed is not None and placed[2]:
            placed = None
    if placed is None:
        match(_all_pairs(len(images)))
        placed = _planar_place(cv2, images, tried)
    if placed is None:
        raise RuntimeError(NO_OVERLAP)
    anchor, solved, dropped, off = placed

    if not solved:
        raise RuntimeError("auto-stitch could not place any piece")

    order = sorted(solved)
    # The homographies are in full-resolution coordinates (`_features` scales its
    # keypoints back), so a unit of this geometry is already one source pixel.
    raw = [solved[i] for i in order]
    canvas = canvas_for_layout(raw, minimum=(width, height))
    fitted = fit_quads_to_canvas(raw, *canvas)
    points = [0 if pts is None else len(pts) for pts, _ in feats]
    return {
        "quads": {i: q for i, q in zip(order, fitted)},
        "dropped": sorted(dropped),
        "why": _why_left_out(dropped, points, off),
        "anchor": anchor,
        "canvas": {"width": canvas[0], "height": canvas[1]},
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


def _detail_features(cv2, arrays: list[Any], strokes: list[Strokes | None] | None = None) -> list[Any]:
    """Features for the rotation model, minus whatever is pinned over the scene.

    Same rejection as the planar solver, applied one step earlier: this pipeline
    matches inside OpenCV, so the overlay's keypoints have to be gone from the
    feature objects before the matcher ever sees them. The painted areas
    (``strokes``, one entry per array) are kept from the detector the same way.
    """
    import numpy as np

    det, _ = _detector(cv2)
    low = _low_detector(cv2)
    feats = []
    for arr, marks in zip(arrays, strokes or [None] * len(arrays)):
        mask = exclusion_mask(marks, (arr.shape[1], arr.shape[0]))
        extra = () if mask is None else (mask,)
        found = cv2.detail.computeImageFeatures2(det, arr, *extra)
        if low is not None and len(found.keypoints) < _FEW_POINTS:
            found = cv2.detail.computeImageFeatures2(low, arr, *extra)
        feats.append(found)

    points = [
        np.asarray([k.pt for k in ft.keypoints], dtype=np.float32) if len(ft.keypoints) else None
        for ft in feats
    ]
    sizes = [(arr.shape[1], arr.shape[0]) for arr in arrays]
    for ft, drop in zip(feats, _static_points(points, sizes)):
        if not drop:
            continue
        keep = [k for k in range(len(ft.keypoints)) if k not in drop]
        if len(keep) < 4:
            continue
        descriptors = ft.descriptors.get()
        ft.keypoints = tuple(ft.keypoints[k] for k in keep)
        ft.descriptors = cv2.UMat(descriptors[keep])
    return feats


def _match_pairs(
    cv2, feats: list[Any], pairs: list[tuple[int, int]] | None = None, before: list[Any] | None = None
) -> list[Any]:
    """OpenCV's pairwise matches (``n × n``, row-major) for ``pairs``, or every pair.

    ``before`` is an earlier answer for the same features: what it already matched
    is kept, and only the pairs it never tried are matched now.
    """
    import numpy as np

    count = len(feats)
    matcher = cv2.detail.BestOf2NearestMatcher_create(False, _MATCH_CONF)
    if pairs is None and before is None:
        pairwise = list(matcher.apply2(feats))
    else:
        wanted = np.zeros((count, count), np.uint8)
        for i, j in pairs if pairs is not None else _all_pairs(count):
            if before is None or before[i * count + j].src_img_idx < 0:
                wanted[i, j] = 1
        pairwise = list(matcher.apply2(feats, wanted))
        if before is not None:
            pairwise = [old if old.src_img_idx >= 0 else new for old, new in zip(before, pairwise)]
    matcher.collectGarbage()
    for match in pairwise:
        _undo_too_close(match)
    return pairwise


def _undo_too_close(match: Any) -> None:
    """Give back the confidence OpenCV takes from a pair it calls too close.

    Its matcher zeroes a pair scoring above 3 (nearly every match an inlier, over
    some 240 matches) as "too close to add anything". Frames a moment apart in a
    sharp video are exactly that, and a set of them then reads as pieces with no
    overlap at all. A pair that close is the most certain one there is.
    """
    if match.src_img_idx < 0 or match.confidence > 0 or match.H is None or match.num_inliers <= 0:
        return
    score = match.num_inliers / (8 + 0.3 * len(match.matches))
    if score > 3:
        match.confidence = score


def _renumber(pairwise: list[Any], count: int, keep: list[int]) -> list[Any]:
    """``pairwise`` restricted to the pieces in ``keep``, numbered by their place there.

    The estimator indexes cameras by position in the features it is handed, so a
    group solved alone has to be re-numbered; its matches stay the ones found.
    """
    out = []
    for a, i in enumerate(keep):
        for b, j in enumerate(keep):
            match = pairwise[i * count + j]
            if match.src_img_idx >= 0:
                match.src_img_idx, match.dst_img_idx = a, b
            out.append(match)
    return out


def _match_component(
    cv2, feats: list[Any], pairs: list[tuple[int, int]] | None = None, before: list[Any] | None = None
) -> tuple[list[Any], list[int]]:
    """Match the pairs (every pair by default), then return the matches + the
    biggest agreeing group.

    Pieces outside that group are not stitched to anything we trust, so the caller
    leaves them exactly where the analyst put them.
    """
    pairwise = _match_pairs(cv2, feats, pairs, before)

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

    # Both solvers answer a scene they cannot resolve two ways: `False`, or an
    # assertion from inside OpenCV. Pieces that overlap just enough to be matched
    # but not enough to be solved take the second road — the ray adjuster asserts
    # on an empty error term rather than reporting failure — and an uncaught
    # `cv2.error` leaves the route with a 500 and a traceback where the analyst
    # should be reading that these pictures do not solve. One outcome, one answer.
    try:
        ok, cameras = cv2.detail_HomographyBasedEstimator().apply(feats, pairwise, None)
    except cv2.error:
        ok = False
    if not ok:
        raise RuntimeError("auto-stitch could not estimate the camera rotations")
    for cam in cameras:
        cam.R = cam.R.astype(np.float32)

    adjuster = cv2.detail_BundleAdjusterRay()
    adjuster.setConfThresh(STITCH_CONF)
    adjuster.setRefinementMask(np.ones((3, 3), np.uint8))
    try:
        ok, cameras = adjuster.apply(feats, _thinned(cv2, pairwise), cameras)
    except cv2.error:
        ok = False
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


# The ray adjuster differentiates numerically, so each of its steps costs cameras ×
# matches: twenty sharp frames whose neighbours share some 1500 inliers a pair took
# 20 s where 7 had done. An even sample of each pair's inliers pins a rotation and a
# focal as well as all of them do.
_ADJUST_INLIERS = 200


def _thinned(cv2, pairwise: list[Any]) -> list[Any]:
    """``pairwise`` for the adjuster: each pair's inliers cut to an even sample of
    :data:`_ADJUST_INLIERS`. Copies, so the matches themselves are left whole."""
    import numpy as np

    out = []
    for match in pairwise:
        if match.src_img_idx < 0 or match.num_inliers <= _ADJUST_INLIERS:
            out.append(match)
            continue
        mask = np.asarray(match.inliers_mask, np.uint8)
        inliers = np.flatnonzero(mask)
        kept = inliers[np.linspace(0, len(inliers) - 1, _ADJUST_INLIERS).round().astype(int)]
        thin = np.zeros_like(mask)
        thin[kept] = 1
        copy = cv2.detail.MatchesInfo()
        copy.src_img_idx, copy.dst_img_idx = match.src_img_idx, match.dst_img_idx
        copy.matches, copy.H, copy.confidence = match.matches, match.H, match.confidence
        copy.inliers_mask = thin
        copy.num_inliers = int(thin.sum())
        out.append(copy)
    return out


# A pan turned less than this between its frames, degrees, says too little of its lens to trust.
LENS_TURN_MIN = 4.0


def lens_of_pan(images: list[Image.Image]) -> dict[str, Any]:
    """The lens a pan was filmed with, read off its frames as the stitch solves them.

    A camera turning on the spot gives frames whose overlaps fit only one focal
    length: the rotation model (`_solve_cameras`) finds each frame's, so a zoom
    that changed during the pan shows. Returns ``{"fovs": {index: degrees across},
    "turn": degrees}``, `turn` how far the camera turned between the frames most
    apart. Raises RuntimeError, said for the analyst, when the frames do not
    overlap, do not solve, or turned too little to tell a lens.
    """
    import numpy as np

    if len(images) < 2:
        raise RuntimeError("Two frames of one pan at the least")
    cv2 = _seeded_cv2()
    arrays = [_work_array(img) for img in images]
    feats = _detail_features(cv2, arrays)
    pairwise, keep = _match_component(cv2, feats)
    if len(keep) < 2:
        raise RuntimeError("These frames do not overlap: the camera must pan, not cut")
    if len(keep) < len(images):
        pairwise = _renumber(pairwise, len(images), keep)
        feats = [feats[i] for i in keep]
    cameras = _solve_cameras(cv2, feats, pairwise)
    turn = 0.0
    for i in range(len(cameras)):
        for j in range(i + 1, len(cameras)):
            relative = np.asarray(cameras[j].R, dtype=np.float64) @ np.asarray(cameras[i].R, dtype=np.float64).T
            cosine = float(np.clip((np.trace(relative) - 1) / 2, -1.0, 1.0))
            turn = max(turn, math.degrees(math.acos(cosine)))
    if turn < LENS_TURN_MIN:
        raise RuntimeError("The camera hardly turned between these frames: pick a moment it pans")
    fovs = {
        idx: 2 * math.degrees(math.atan(arrays[idx].shape[1] / 2 / float(cameras[pos].focal)))
        for pos, idx in enumerate(keep)
    }
    return {"fovs": fovs, "turn": turn}


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


def _rotation_place(cv2, arrays: list[Any], feats: list[Any], pairwise: list[Any], keep: list[int], warp: str):
    """Solve the cameras of the group ``keep`` and warp it: ``(quads, remaps, dropped,
    off)``, quads in warp pixels, ``off`` the dropped pieces whose projection failed.
    Raises RuntimeError when the group does not solve."""
    import numpy as np

    count = len(arrays)
    if len(keep) < 2:
        raise RuntimeError(NO_OVERLAP)
    if len(keep) < count:
        pairwise = _renumber(pairwise, count, keep)
        feats = [feats[i] for i in keep]

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
    dropped = [i for i in range(count) if i not in set(keep)]
    off: set[int] = set()
    for pos, idx in enumerate(keep):
        src_h, src_w = arrays[idx].shape[:2]
        out_h, out_w = warped[pos].shape[:2]
        x, y = float(corners[pos][0]), float(corners[pos][1])
        quad = [[x, y], [x + out_w, y], [x + out_w, y + out_h], [x, y + out_h]]
        if not quad_ok(quad) or (out_w * out_h) > _MAX_WARP_AREA * src_w * src_h:
            dropped.append(idx)
            off.add(idx)
            continue
        quads[idx] = quad
        remaps[idx] = _remap_params(warp, cameras[pos], scale, (src_w, src_h), gains[pos])
    return quads, remaps, dropped, off


def solve_rotation_layout(
    images: list[Image.Image],
    *,
    width: int,
    height: int,
    warp: str = "cylindrical",
    sources: list[tuple[str, float | None]] | None = None,
    exclude: list[Strokes | None] | None = None,
) -> dict[str, Any]:
    """Solve a panorama layout under the rotation model — geometry *and* a remap.

    Returns ``{"quads": {index: quad}, "remaps": {index: params}, "dropped": [...],
    "why": [...], "canvas": {"width", "height"}}``. Each quad is the upright
    rectangle the piece's remapped pixels fill, in canvas pixels; each remap is the
    op that produces those pixels from the piece's recipe. ``dropped`` holds the
    pieces no trusted match reached — the caller leaves them untouched, ``why``
    says why each was, and ``canvas`` sizes the answer, all exactly as in
    :func:`solve_layout`. ``sources`` and ``exclude`` are read as there too.
    """
    if len(images) < 2:
        raise ValueError("auto-stitch needs at least two pieces")
    if warp not in WARPS:
        raise ValueError(f"unknown panorama warp {warp!r}")
    strokes = _strokes_of(exclude, len(images))

    cv2 = _seeded_cv2()
    arrays = [_work_array(img) for img in images]
    feats = _detail_features(cv2, arrays, strokes)

    placed = None
    pairwise = None
    near = near_pairs(sources, len(images))
    if near is not None:
        pairwise, keep = _match_component(cv2, feats, near)
        if len(keep) == len(images):
            try:
                placed = _rotation_place(cv2, arrays, feats, pairwise, keep, warp)
            except RuntimeError:
                placed = None
            if placed is not None and placed[2]:
                placed = None
    if placed is None:
        # every pair, the ones matched above kept rather than matched twice
        pairwise, keep = _match_component(cv2, feats, before=pairwise)
        placed = _rotation_place(cv2, arrays, feats, pairwise, keep, warp)
    quads, remaps, dropped, off = placed

    if not quads:
        raise RuntimeError("auto-stitch could not place any piece")

    order = sorted(quads)
    raw = [quads[i] for i in order]
    # This model projects the *work* copy of each piece, so one unit of its
    # geometry is worth however much the finest piece was downscaled by. Sizing on
    # the largest factor is what keeps that piece at full detail; a coarser one is
    # merely upscaled into a canvas with room to spare.
    detail = max((1.0 / _work_scale(images[i].size) for i in order), default=1.0)
    canvas = canvas_for_layout(raw, detail=detail, minimum=(width, height))
    fitted = fit_quads_to_canvas(raw, *canvas)
    return {
        "quads": {i: q for i, q in zip(order, fitted)},
        "remaps": remaps,
        "dropped": sorted(dropped),
        "why": _why_left_out(dropped, [len(ft.keypoints) for ft in feats], off),
        "canvas": {"width": canvas[0], "height": canvas[1]},
    }


def _remap_of(node: dict[str, Any]) -> dict[str, Any] | None:
    """The rotation model's warp a collage piece carries in its recipe, if any."""
    save = node.get("save")
    ops = save.get("ops") if isinstance(save, dict) else None
    for op in [*(ops or []), *(node.get("frameOps") or [])]:
        params = op.get("params") if isinstance(op, dict) and op.get("op") == "remap" else None
        if isinstance(params, dict) and params.get("warp") in WARPS and len(params.get("r") or []) == 9:
            return params
    return None


def strip_scale(nodes: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Canvas pixels per degree of turn along a collage stitched on a cylinder or a sphere.

    Each piece the rotation model placed keeps its camera's rotation in its remap
    op: the third column of ``r`` is where that camera looked, in the panorama's
    frame, and the warp lays every degree of turn as the same number of pixels all
    along the strip. So the pieces' middles against their headings fall on one
    line, whose slope is the strip's scale. Pieces laid by hand are counted, not
    read. None when fewer than two pieces were stitched, when they turn less than
    a degree between them, or when they disagree (moved by hand after the stitch).

    Returns ``{"per_degree", "stitched", "by_hand", "warp"}``.
    """
    import numpy as np

    rows: list[tuple[float, float]] = []
    warps: set[str] = set()
    by_hand = 0
    for node in nodes:
        quad = node.get("quad") if isinstance(node, dict) else None
        if not isinstance(quad, list) or len(quad) != 4:
            continue
        params = _remap_of(node)
        if params is None:
            by_hand += 1
            continue
        r = [float(v) for v in params["r"]]
        heading = math.degrees(math.atan2(r[2], r[8]))
        middle = sum(float(x) for x, _ in quad) / 4
        if not (math.isfinite(heading) and math.isfinite(middle)):
            continue
        rows.append((heading, middle))
        warps.add(str(params["warp"]))
    if len(rows) < 2 or len(warps) != 1:
        return None
    # along the strip, so a turn across north is unwrapped in the order it was laid
    rows.sort(key=lambda row: row[1])
    headings = np.unwrap(np.radians([h for h, _ in rows]))
    middles = np.array([m for _, m in rows])
    turn = math.degrees(float(headings.max() - headings.min()))
    span = float(middles.max() - middles.min())
    if turn < 1.0 or span <= 0:
        return None
    slope, offset = np.polyfit(np.degrees(headings), middles, 1)
    off = np.abs(middles - (slope * np.degrees(headings) + offset))
    if float(off.max()) > STRIP_AGREE * span:
        return None
    return {"per_degree": abs(float(slope)), "stitched": len(rows), "by_hand": by_hand, "warp": warps.pop()}
