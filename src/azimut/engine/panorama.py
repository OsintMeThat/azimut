"""Collage → Panorama: the frames of a panorama, picked from a stretch of video.

The analyst marks where a pan starts and ends on the video's bar, and this answers
the moments to cut; the Collage tool then stitches them on a cylinder
(:func:`azimut.engine.stitch.solve_rotation_layout`). Cut by hand, every frame was a
guess at the overlap.

The rule is plain. The stretch is read once, small and grey
(:func:`azimut.engine.inspect.grey_stream`), and the camera's image motion is
followed from frame to frame. A frame is kept each time the picture has travelled
about a third of itself since the last one kept, the sharpest frame near that point,
so neighbours overlap by about 60%; the stretch's first and last views are kept too.
A shot cut is never crossed, and the count is capped at :data:`MAX_FRAMES`.

The motion is read block by block (:class:`_Tracker`): a grid over the picture, each
block matched by phase correlation against the same block of a reference frame, the
camera's motion the median of the blocks. Burnt-in furniture (a channel logo, a
timestamp) sits still while the scene moves, and the blocks holding it are found
and left out (:func:`_pinned_blocks`), as the stitcher drops its static keypoints
(``stitch._static_points``).

Every step is deterministic: the same stretch always answers the same times.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from ..workspace import Case
from . import inspect as inspect_engine
from . import media as media_engine

# A collage of more pieces is slow to stitch and to export, and past it a pan is
# better cut into two panoramas than stretched thinner.
MAX_FRAMES = 16

# The longest stretch read at once, seconds. A pan runs seconds; a stretch of
# minutes is a whole video, and the route answers while the analyst waits.
MAX_STRETCH = 120.0

# Travel, as a share of the picture along the motion, from one kept frame to the
# next. A third leaves neighbours about 60% overlap once the window below is taken,
# which the stitcher matches surely; the owner's own collages cut by hand sat
# between a quarter and a half (see the bench in the commit that set these).
STEP = 1 / 3
# Around each target, the sharpest frame whose travel from the last kept frame
# stays within this share of the step either side.
STEP_WINDOW = 0.15
# The first and last views: the sharpest frame within this travel of the
# stretch's start (or end) stands for it.
EDGE_TRAVEL = 0.05
# The end's view is added when it sits at least this far past the last frame kept;
# closer, that frame already shows it.
END_STEP = 0.1
# Below this travel over the whole stretch, the camera barely moved.
MIN_TRAVEL = 0.1
# Spread over a pan too long for MAX_FRAMES, neighbours overlapping less than this
# may not match; the answer says so.
RISKY_OVERLAP = 0.4
# Fewer decoded frames than this is too short a stretch to follow.
MIN_FRAMES = 3

# The motion is read on the scan's grey frames brought down to this longest side,
# cut into a grid of GRID blocks along the short side, square, as many across as fit.
MOTION_DIM = 320
GRID = 3
# A block whose grey levels spread less than this is flat (clear sky, a wall in
# shadow): it shows nothing that could move.
FLAT = 1.0
# A block's phase correlation is believed from this response up. Measured on the
# owner's 17 clips (motion frames, 15 blocks each): a block against the same block
# a frame later answers 0.94 at the median, 5% of them under 0.36; a block against
# the same place in another clip answers 0.06 at the median, 3% of them over 0.3.
MIN_RESPONSE = 0.3
# A reading needs this many believed blocks, so one block can never be the camera.
MIN_BLOCKS = 2
# The reference frame moves on once a believed block has drifted this share of a
# block from it, so a match never runs out of overlap, and once this many frames in
# a row read nothing.
REANCHOR = 0.125
LOST_STEPS = 5

# A block is pinned over the scene (a logo, a timestamp) when, in the frames where at
# least MOVING_BLOCKS believed blocks moved MOVE_PX or more, it stayed within
# STILL_PX in PINNED_SHARE of those it was believed in. Past PINNED_MAX of the blocks
# the scene itself is what stands still (a still camera with a car crossing it),
# and nothing is pinned.
MOVE_PX = 1.0
STILL_PX = 0.3
MOVING_BLOCKS = 2
PINNED_SHARE = 0.8
PINNED_MAX = 0.5

# A camera moving forward or zooming spreads the blocks out from the middle rather
# than moving them together: over this change of scale while the picture travels
# under MIN_TRAVEL, the stretch is a dolly or a zoom, not a pan.
FORWARD_SCALE = 0.2

# At most this many frames are decoded: past it, one frame in so many is read, and
# never more than MAX_RATE a second, which a pan does not need.
MAX_DECODED = 1800
MAX_RATE = 30.0

NOTE_SHORT = "The stretch is too short for a panorama."
NOTE_STILL = "The camera barely moves here, so one frame is enough."
NOTE_UNREAD = "The picture has too little detail here to follow the camera."
NOTE_FORWARD = "The camera moves forward or zooms here rather than turning, so its frames will not stitch."
NOTE_CUT = "The stretch crosses a shot cut, so the frames come from its longest part."
NOTE_SPREAD = "Spread over this pan, {count} frames overlap by only about {overlap}%, so some may not stitch."


def _cv2():
    import cv2

    return cv2


class _Tracker:
    """The camera's image motion between two grey frames, read block by block.

    The picture is cut into square blocks, :data:`GRID` along its short side, and each
    block of the current frame is phase-correlated with the same block of a reference
    frame: a shift and how sure the match is. Phase correlation keeps only the
    structure of a block, not its brightness, so a flash or an exposure drift does not
    move it.
    """

    def __init__(self, width: int, height: int):
        cv2 = _cv2()
        side = max(8, min(width, height) // GRID)
        cols, rows = max(1, width // side), max(1, height // side)
        left, top = (width - cols * side) // 2, (height - rows * side) // 2
        self.size = (width, height)
        self.side = side
        self.boxes = [(left + c * side, top + r * side) for r in range(rows) for c in range(cols)]
        # where each block's middle sits from the picture's, pixels: a zoom moves
        # blocks out in proportion to it
        self.centres = np.array(
            [[x + side / 2 - width / 2, y + side / 2 - height / 2] for x, y in self.boxes], dtype=np.float64
        )
        self.window = cv2.createHanningWindow((side, side), cv2.CV_32F)

    def blocks(self, frame: Any) -> list[Any]:
        """The frame's blocks, each less its own mean, or None for a block flat to the eye.

        The mean has to go: left in, the window's own shape is all a flat block of sky
        shows, and it matches itself at no shift better than any texture matches its
        moved copy (measured: 0.83 to 1.0 against 0.13 for a blurred texture moved
        4 pixels). Taken out, flat sky answers what noise does, under 0.12.
        """
        out = []
        for x, y in self.boxes:
            block = frame[y : y + self.side, x : x + self.side]
            mean, deviation = _cv2().meanStdDev(block)
            out.append(None if float(deviation[0, 0]) < FLAT else np.ascontiguousarray(block - float(mean[0, 0])))
        return out

    def measure(self, ref: list[Any], cur: list[Any]) -> Any:
        """``(blocks, 3)``: each block's shift from ``ref`` to ``cur`` (x, y) and its
        response, which is 0 where either block is flat."""
        cv2 = _cv2()
        out = np.zeros((len(ref), 3), dtype=np.float64)
        for k, (a, b) in enumerate(zip(ref, cur)):
            if a is not None and b is not None:
                (dx, dy), response = cv2.phaseCorrelate(a, b, self.window)
                out[k] = (dx, dy, response)
        return out


@dataclass
class _Stretch:
    """What one pass over the stretch leaves: numbers only, no frames."""

    focus: list[float] = field(default_factory=list)
    # each frame's block readings against its reference, None where tracking began
    readings: list[Any] = field(default_factory=list)
    # each frame's reference frame, -1 where tracking began (the first frame, a cut)
    anchor: list[int] = field(default_factory=list)
    cuts: list[int] = field(default_factory=list)


def _motion_size(width: int, height: int) -> tuple[int, int]:
    longest = max(width, height)
    scale = min(1.0, MOTION_DIM / longest) if longest else 1.0
    return max(8, round(width * scale)), max(8, round(height * scale))


def _read(video_path: Any, meta: dict[str, Any], seek: float, length: float, every: int) -> tuple[_Stretch, list[float], _Tracker]:
    """One pass over the stretch: focus, cuts and the tracker's readings, then the times."""
    cv2 = _cv2()
    width, height = int(meta.get("width") or 0), int(meta.get("height") or 0)
    if abs(int(meta.get("rotation") or 0)) % 180 == 90:
        width, height = height, width  # ffmpeg turns the picture upright as it decodes
    size = inspect_engine._scan_size(width, height)
    motion = _motion_size(*size)
    tracker = _Tracker(*motion)
    fps = float(meta.get("fps") or 0)
    gap = inspect_engine.MIN_SHOT_GAP * fps / every  # frames read between two cuts at least
    out = _Stretch()
    state: dict[str, Any] = {"prev": None, "mafd": None, "ref": None, "ref_at": -1, "lost": 0, "cut_at": -math.inf}

    def take(gray: Any) -> None:
        index = len(out.focus)
        out.focus.append(inspect_engine._focus_score(gray))
        cut = False
        if state["prev"] is not None:
            score, mafd = inspect_engine._cut_score(gray, state["prev"], state["mafd"] if state["mafd"] is not None else 0.0)
            if state["mafd"] is not None and score > inspect_engine.SHOT_THRESHOLD and index - state["cut_at"] >= gap:
                cut = True
                state["cut_at"] = index
                out.cuts.append(index)
            state["mafd"] = mafd
        state["prev"] = gray
        small = cv2.resize(gray, motion, interpolation=cv2.INTER_AREA).astype(np.float32)
        here = tracker.blocks(small)
        if state["ref"] is None or cut:
            out.readings.append(None)
            out.anchor.append(-1)
            state.update(ref=here, ref_at=index, lost=0)
            return
        reading = tracker.measure(state["ref"], here)
        out.readings.append(reading)
        out.anchor.append(state["ref_at"])
        believed = reading[:, 2] >= MIN_RESPONSE
        if int(believed.sum()) >= MIN_BLOCKS:
            state["lost"] = 0
            drift = np.hypot(reading[believed, 0], reading[believed, 1]).max()
            if drift >= REANCHOR * tracker.side:
                state.update(ref=here, ref_at=index)
        else:
            state["lost"] += 1
            if state["lost"] >= LOST_STEPS:
                state.update(ref=here, ref_at=index, lost=0)

    times = inspect_engine.grey_stream(
        video_path, size, take, timeout=inspect_engine._scan_timeout(length), what="read",
        start=seek, length=length, every=every, stamps=True,
    )
    assert times is not None
    return out, times, tracker


def _pinned_blocks(readings: list[Any], count: int) -> Any:
    """Which blocks hold something pinned over the scene, as a boolean per block."""
    rows = [r for r in readings if r is not None]
    pinned = np.zeros(count, dtype=bool)
    if not rows:
        return pinned
    stack = np.stack(rows)
    shift = np.hypot(stack[:, :, 0], stack[:, :, 1])
    believed = stack[:, :, 2] >= MIN_RESPONSE
    moving = (believed & (shift >= MOVE_PX)).sum(axis=1) >= MOVING_BLOCKS
    if not moving.any():
        return pinned
    for b in range(count):
        seen = moving & believed[:, b]
        if seen.sum() < max(3, 0.5 * moving.sum()):
            continue
        pinned[b] = float((shift[seen, b] < STILL_PX).mean()) >= PINNED_SHARE
    if pinned.sum() > PINNED_MAX * count:
        pinned[:] = False
    return pinned


def _track(stretch: _Stretch, tracker: _Tracker) -> tuple[Any, Any, Any, Any]:
    """Each frame's position (shares of the picture), scale, segment and whether it was read.

    A frame's position is its reference's plus the median shift of the believed,
    unpinned blocks; a frame that reads nothing keeps the frame before's. A segment
    runs from one cut (or the first frame) to the next.
    """
    count = len(stretch.focus)
    width, height = tracker.size
    pinned = _pinned_blocks(stretch.readings, len(tracker.boxes))
    pos = np.zeros((count, 2), dtype=np.float64)
    scale = np.zeros(count, dtype=np.float64)  # log of the picture's scale since the segment began
    segment = np.zeros(count, dtype=np.int64)
    read = np.zeros(count, dtype=bool)
    seg = -1
    for i in range(count):
        reading, ref = stretch.readings[i], stretch.anchor[i]
        if reading is None or ref < 0:
            seg += 1
            segment[i] = seg
            read[i] = True
            continue
        segment[i] = seg
        use = (reading[:, 2] >= MIN_RESPONSE) & ~pinned
        if int(use.sum()) < MIN_BLOCKS:
            pos[i], scale[i] = pos[i - 1], scale[i - 1]
            continue
        shift = reading[use, :2]
        moved = np.median(shift, axis=0)
        pos[i] = pos[ref] + (moved[0] / width, moved[1] / height)
        centres = tracker.centres[use]
        spread = centres - centres.mean(axis=0)
        denom = float((spread**2).sum())
        grow = float(((shift - shift.mean(axis=0)) * spread).sum() / denom) if denom > 0 else 0.0
        scale[i] = scale[ref] + math.log1p(max(grow, -0.5))
        read[i] = True
    return pos, scale, segment, read


def _near(positions: Any, centre: int) -> list[int]:
    """The run of frames round ``centre`` that stay within :data:`EDGE_TRAVEL` of its view."""
    out = [centre]
    for step in (-1, 1):
        j = centre + step
        while 0 <= j < len(positions) and float(np.hypot(*(positions[j] - positions[centre]))) <= EDGE_TRAVEL:
            out.append(j)
            j += step
    return sorted(out)


def _sharpest(focus: Any, among: list[int]) -> int:
    """The sharpest of ``among``, the earliest on a tie."""
    return max(among, key=lambda j: (focus[j], -j))


def _walk(positions: Any, focus: Any, step: float) -> list[int]:
    """The frames kept at ``step`` of travel apart, as indices into ``positions``, in order.

    A frame is due once the picture has travelled ``step`` past *every* frame kept so
    far, not just the last one: a camera that sweeps back and forth over the same
    ground adds nothing on its way back. The sharpest frame of the run that stays
    within :data:`STEP_WINDOW` of the step is kept. Then the views at the edges, the
    stretch's last and the farthest the camera reached each way across and up and
    down, are added where no frame kept shows them yet. An axis the camera never moved
    along by :data:`END_STEP` has no far views: its extremes are only noise.
    """
    count = len(positions)
    kept = [_sharpest(focus, _near(positions, 0))]
    nearest = np.hypot(*(positions - positions[kept[0]]).T)
    low, high = step * (1 - STEP_WINDOW), step * (1 + STEP_WINDOW)
    j = kept[0] + 1
    while j < count:
        if nearest[j] < low:
            j += 1
            continue
        window = [j]
        while window[-1] + 1 < count and low <= nearest[window[-1] + 1] <= high:
            window.append(window[-1] + 1)
        pick = _sharpest(focus, window)
        kept.append(pick)
        nearest = np.minimum(nearest, np.hypot(*(positions - positions[pick]).T))
        j = pick + 1
    reach = positions.max(axis=0) - positions.min(axis=0)
    edges = [count - 1]
    for a in (0, 1):
        if reach[a] >= END_STEP:
            edges += [int(np.argmin(positions[:, a])), int(np.argmax(positions[:, a]))]
    for edge in edges:
        if nearest[edge] >= END_STEP:
            pick = _sharpest(focus, _near(positions, edge))
            kept.append(pick)
            nearest = np.minimum(nearest, np.hypot(*(positions - positions[pick]).T))
    return sorted(set(kept))


def _capped(positions: Any, focus: Any) -> tuple[list[int], float]:
    """The frames kept, at most :data:`MAX_FRAMES`, and the step they were kept at.

    Past the cap the step grows, found by halving, until the walk fits; a pan that
    still does not fit (one that turns back on itself) is thinned evenly.
    """
    kept = _walk(positions, focus, STEP)
    if len(kept) <= MAX_FRAMES:
        return kept, STEP
    low, high = STEP, 1.0
    best = _walk(positions, focus, high)
    if len(best) > MAX_FRAMES:
        picks = [best[round(k * (len(best) - 1) / (MAX_FRAMES - 1))] for k in range(MAX_FRAMES)]
        return picks, high
    for _ in range(20):
        middle = (low + high) / 2
        trial = _walk(positions, focus, middle)
        if len(trial) <= MAX_FRAMES:
            best, high = trial, middle
        else:
            low = middle
    return best, high


def pick_frames(case: Case, video_rel: str, start: float, end: float) -> dict[str, Any]:
    """The moments to cut for a panorama of the video ``video_rel`` between ``start`` and ``end``.

    Returns ``{"times": [...], "note": str | None}``: ascending frame timestamps, each
    the frame's own (what Inspect saves a frame at, and what
    :func:`azimut.engine.inspect.render_preview` renders that very frame from). Fewer
    than two times is no panorama, and ``note`` says why; with two or more it is
    None or says one thing worth knowing.

    Raises ValueError for a stretch that is no stretch of this video, RuntimeError
    when ffmpeg is missing or fails, CaseError for a path outside the case.
    """
    if not (math.isfinite(start) and math.isfinite(end)):
        raise ValueError("a stretch is a start and an end in seconds")
    if start < 0 or end <= start:
        raise ValueError("a stretch ends after it starts")
    if end - start > MAX_STRETCH:
        raise ValueError(f"a panorama is picked from {MAX_STRETCH:g} seconds of video at most")
    path = case.resolve_inside(video_rel)
    if media_engine.media_kind(path.name) != "video":
        raise ValueError("only a video has frames to pick")
    if not path.is_file():
        raise ValueError("this video is not in the case")
    if not media_engine.ffmpeg_available():
        raise RuntimeError("ffmpeg is required to pick the frames of a panorama")
    meta = inspect_engine.probe(case, video_rel)
    fps, duration = float(meta.get("fps") or 0), float(meta.get("duration") or 0)
    if fps <= 0 or duration <= 0:
        raise RuntimeError("could not read the video's duration and frame rate (ffprobe needed)")
    frame = 1 / fps
    if start >= duration:
        raise ValueError("the stretch starts after the video ends")
    if end > duration + frame:
        raise ValueError("the stretch ends after the video does")
    end = min(end, duration)

    every = max(1, math.ceil(fps / MAX_RATE), math.ceil((end - start) * fps / MAX_DECODED))
    # a frame early, so the frame showing at the start is read even mid-frame
    seek = max(0.0, start - frame)
    stretch, times, tracker = _read(path, meta, seek, end - seek + frame, every)
    return _choose(stretch, times, tracker, start, end, frame)


def _choose(stretch: _Stretch, times: list[float], tracker: _Tracker, start: float, end: float, frame: float) -> dict[str, Any]:
    """The pick itself, from what the pass over the stretch left."""
    positions, scale, segment, read = _track(stretch, tracker)
    inside = [i for i, t in enumerate(times) if start - frame + 1e-6 < t <= end + 1e-6]
    if len(inside) < MIN_FRAMES:
        return {"times": [], "note": NOTE_SHORT}

    parts: dict[int, list[int]] = {}
    for i in inside:
        parts.setdefault(int(segment[i]), []).append(i)
    # the longest part, the earliest of two as long
    chosen = max(parts.values(), key=lambda part: (times[part[-1]] - times[part[0]], -part[0]))
    notes = [NOTE_CUT] if len(parts) > 1 else []
    if len(chosen) < MIN_FRAMES:
        return {"times": [], "note": NOTE_SHORT}
    if float(read[chosen[1:]].mean()) < 0.5:
        return {"times": [], "note": NOTE_UNREAD}

    where = positions[chosen] - positions[chosen[0]]
    extent = float(np.hypot(*(where.max(axis=0) - where.min(axis=0))))
    if extent < MIN_TRAVEL:
        zoom = scale[chosen] - scale[chosen[0]]
        if float(np.abs(zoom).max()) >= math.log1p(FORWARD_SCALE):
            return {"times": [], "note": NOTE_FORWARD}
        return {"times": [], "note": NOTE_STILL}

    focus = np.asarray([stretch.focus[i] for i in chosen])
    kept, step = _capped(where, focus)
    if len(kept) < 2:
        return {"times": [], "note": NOTE_STILL}
    overlap = 1 - step
    if overlap < RISKY_OVERLAP:
        notes.append(NOTE_SPREAD.format(count=len(kept), overlap=round(overlap * 100)))
    return {"times": [times[chosen[k]] for k in kept], "note": " ".join(notes) or None}
