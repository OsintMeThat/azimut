"""Media inspection engine: open a photo or video, pull frames, adjust and
analyse imagery — all locally, Pillow + ffmpeg only (spec §7).

Two self-describing registries make new mini-tools cheap to add (the whole point
of this module's design):

* ``FILTERS`` — pixel transforms applied as an ordered pipeline. Each declares a
  parameter schema and an optional CSS hint so the frontend can live-preview
  without a round-trip. Adding an adjustment = one ``@filter`` function.
* ``ANALYSES`` — read-only inspectors that return one of a small set of render
  kinds (``keyvalue`` / ``image`` / ``text``). The frontend has a generic
  renderer per kind, so adding an analysis = one ``@analysis`` function.

Everything the tools produce is filed back as ordinary case media (via the media
engine) with provenance recording how it was derived — honest, auditable output
(spec §6). Nothing here mutates the original media.
"""

from __future__ import annotations

import base64
import io
import json
import logging
import math
import os
import re
import subprocess
import tempfile
import threading
import uuid
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from PIL import Image, ImageChops, ImageEnhance, ImageOps

from ..workspace import Case, CaseError, ensure_dir
from . import ffmpeg as ffmpeg_engine
from . import media as media_engine
from . import stitch, thumbnails

logger = logging.getLogger(__name__)

SUGGEST_CAP = 60  # hard cap on how many "sharpest frame" suggestions we return

# The sharpest-frame scan reads *every* frame in one ffmpeg pass, decoded to
# greyscale at this max dimension. Full resolution buys no discrimination for a
# focus measure but costs real time; this is small enough to stream a long clip
# and large enough to tell a sharp frame from a soft one.
SCAN_DIM = 480

# Shot cuts, read off the scan's grey frames with ffmpeg ``scdet``'s measure. A cut
# needs a score above ``SHOT_THRESHOLD`` (scdet's own default) and must sit
# ``MIN_SHOT_GAP`` seconds after the one before, so a flash does not read as two.
# Past ``SHOTS_CAP`` shots only the strongest cuts are kept.
SHOT_THRESHOLD = 10.0
MIN_SHOT_GAP = 0.5
SHOTS_CAP = 300

# The overview sprite: up to TILES_MAX evenly spread tiles, TILE_COLUMNS to a row,
# and the waveform reduced to WAVEFORM_BUCKETS peaks.
TILES_MAX = 120
TILE_COLUMNS = 10
TILE_WIDTH = 160
WAVEFORM_BUCKETS = 800



def ffmpeg_failed(what: str, stderr: bytes | None) -> RuntimeError:
    """ffmpeg's last word, without the path it names, as the reason a step failed.

    Its stderr runs to a screen of build flags and stream maps; the log keeps all of
    it and the page gets one line: "ffmpeg could not scan this video (Invalid data
    found when processing input)".
    """
    text = (stderr or b"").decode("utf-8", "replace").strip()
    if text:
        logger.warning("ffmpeg failed to %s a video:\n%s", what, text[-4000:])
    last = text.splitlines()[-1].rsplit(": ", 1)[-1].strip() if text else ""
    reason = f" ({last[:120]})" if last else ""
    return RuntimeError(f"ffmpeg could not {what} this video{reason}")

def _scan_timeout(duration: float) -> float:
    """Allow slow software decoding without letting a broken scan run forever."""
    return max(30.0, min(1800.0, duration * 4 + 15))


def _stop_process(proc: subprocess.Popen[Any]) -> None:
    """Stop a child promptly, escalating when graceful termination stalls."""
    if proc.poll() is not None:
        return
    proc.terminate()
    try:
        proc.wait(timeout=2)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=2)


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------------------
# Filter registry (pixel-transform pipeline)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Param:
    name: str
    label: str
    type: str = "range"  # 'range' | 'toggle' | 'choice'
    min: float = 0.0
    max: float = 2.0
    step: float = 0.01
    default: float = 1.0
    unit: str = ""
    options: tuple[dict[str, Any], ...] = ()  # a 'choice' param's {value, label} list


@dataclass(frozen=True)
class Filter:
    id: str
    label: str
    apply: Callable[[Image.Image, dict[str, Any]], Image.Image]
    params: list[Param] = field(default_factory=list)
    # optional live-preview hints for the frontend (skip a server round-trip):
    css: str | None = None  # CSS `filter` fragment, e.g. "brightness({v})"
    transform: str | None = None  # CSS `transform` fragment, e.g. "rotate({v}deg)"

    def schema(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "params": [{**vars(p), "options": list(p.options)} for p in self.params],
            "css": self.css,
            "transform": self.transform,
        }


FILTERS: dict[str, Filter] = {}


def _register_filter(f: Filter) -> Filter:
    FILTERS[f.id] = f
    return f


def _p(params: dict[str, Any], name: str, default: float) -> float:
    try:
        return float(params.get(name, default))
    except (TypeError, ValueError):
        return default


def _enhance(cls):
    return lambda img, params: cls(img).enhance(_p(params, "amount", 1.0))


_register_filter(Filter(
    "brightness", "Brightness", _enhance(ImageEnhance.Brightness),
    [Param("amount", "Amount", min=0, max=2, default=1)], css="brightness({v})",
))
_register_filter(Filter(
    "contrast", "Contrast", _enhance(ImageEnhance.Contrast),
    [Param("amount", "Amount", min=0, max=2, default=1)], css="contrast({v})",
))
_register_filter(Filter(
    "saturation", "Saturation", _enhance(ImageEnhance.Color),
    [Param("amount", "Amount", min=0, max=2, default=1)], css="saturate({v})",
))
_register_filter(Filter(
    "sharpness", "Sharpness", _enhance(ImageEnhance.Sharpness),
    [Param("amount", "Amount", min=0, max=3, default=1)],
))


def _apply_gamma(img: Image.Image, params: dict[str, Any]) -> Image.Image:
    g = max(_p(params, "amount", 1.0), 0.01)
    lut = [min(255, round((i / 255) ** (1 / g) * 255)) for i in range(256)]
    return img.point(lut * len(img.getbands()))


_register_filter(Filter(
    "gamma", "Gamma", _apply_gamma,
    [Param("amount", "Amount", min=0.2, max=3, default=1)],
))
_register_filter(Filter(
    "grayscale", "Grayscale",
    lambda img, params: ImageOps.grayscale(img).convert("RGB") if _p(params, "on", 0) else img,
    [Param("on", "On", type="toggle", default=0)], css="grayscale({v})",
))
_register_filter(Filter(
    "invert", "Invert",
    lambda img, params: ImageOps.invert(img.convert("RGB")) if _p(params, "on", 0) else img,
    [Param("on", "On", type="toggle", default=0)], css="invert({v})",
))
_register_filter(Filter(
    "rotate", "Rotate",
    lambda img, params: img.rotate(-_p(params, "angle", 0), expand=True, fillcolor=(16, 20, 28)),
    [Param("angle", "Angle", min=-180, max=180, step=1, default=0, unit="°")],
    transform="rotate({v}deg)",
))


def _apply_crop(img: Image.Image, params: dict[str, Any]) -> Image.Image:
    """Crop from fractional (0..1) x/y/w/h relative to the image."""
    w, h = img.size
    x0 = max(0, min(w, round(_p(params, "x", 0) * w)))
    y0 = max(0, min(h, round(_p(params, "y", 0) * h)))
    x1 = max(x0 + 1, min(w, round((_p(params, "x", 0) + _p(params, "w", 1)) * w)))
    y1 = max(y0 + 1, min(h, round((_p(params, "y", 0) + _p(params, "h", 1)) * h)))
    return img.crop((x0, y0, x1, y1))


_register_filter(Filter("crop", "Crop", _apply_crop))  # driven by an interactive box, no sliders



def _apply_denoise(img: Image.Image, params: dict[str, Any]) -> Image.Image:
    """Non-local-means denoise, strength = the slider (0 leaves the pixels alone).

    A 7 px template over a 9 px search window: about half a second on a 1080p
    frame, where OpenCV's default 21 px window runs several times longer for a
    barely finer result.
    """
    import cv2
    import numpy as np

    amount = max(0.0, min(_p(params, "amount", 0), 20.0))
    if amount <= 0:
        return img
    rgb = np.ascontiguousarray(np.asarray(img.convert("RGB")))
    out = cv2.fastNlMeansDenoisingColored(rgb, None, amount, amount, 7, 9)
    return Image.fromarray(out)


def _apply_clahe(img: Image.Image, params: dict[str, Any]) -> Image.Image:
    """Local contrast: CLAHE on the lightness channel only, so colours stay put."""
    import cv2
    import numpy as np

    amount = max(0.0, min(_p(params, "amount", 0), 4.0))
    if amount <= 0:
        return img
    lab = cv2.cvtColor(np.ascontiguousarray(np.asarray(img.convert("RGB"))), cv2.COLOR_RGB2LAB)
    lab[:, :, 0] = cv2.createCLAHE(clipLimit=amount, tileGridSize=(8, 8)).apply(lab[:, :, 0])
    return Image.fromarray(cv2.cvtColor(lab, cv2.COLOR_LAB2RGB))


def _apply_channel(img: Image.Image, params: dict[str, Any]) -> Image.Image:
    """Show one colour band as a grey picture (0 = all bands, untouched)."""
    pick = int(_p(params, "pick", 0))
    if pick not in (1, 2, 3):
        return img
    return img.convert("RGB").getchannel(pick - 1).convert("RGB")


# None of these has a CSS equivalent, so they carry no live-preview hint: the
# frontend renders them server-side.
_register_filter(Filter(
    "denoise", "Denoise", _apply_denoise,
    [Param("amount", "Amount", min=0, max=20, step=1, default=0)],
))
_register_filter(Filter(
    "autolevels", "Auto levels",
    lambda img, params: (
        ImageOps.autocontrast(img.convert("RGB"), cutoff=1, preserve_tone=True)
        if _p(params, "on", 0) else img
    ),
    [Param("on", "On", type="toggle", default=0)],
))
_register_filter(Filter(
    "clahe", "Local contrast", _apply_clahe,
    [Param("amount", "Amount", min=0, max=4, step=0.1, default=0)],
))
_register_filter(Filter(
    "channel", "Channel", _apply_channel,
    [Param("pick", "Channel", type="choice", default=0, options=(
        {"value": 0, "label": "All"}, {"value": 1, "label": "Red"},
        {"value": 2, "label": "Green"}, {"value": 3, "label": "Blue"},
    ))],
))

# Auto-stitch's panorama modes bake their projection into the piece's recipe, so
# the full-res export re-derives the very warp the solver measured. Solved by
# machine, never by slider — like crop, it has no params of its own.
_register_filter(Filter("remap", "Panorama warp", lambda img, params: stitch.apply_warp(img, params)))

# Filters that speak RGBA themselves: the remap *produces* the alpha, and a crop
# carries whatever it is handed straight through.
_ALPHA_NATIVE = {"remap", "crop"}


def _apply_keeping_alpha(flt: Filter, img: Image.Image, params: dict[str, Any]) -> Image.Image:
    """Run a filter on RGB pixels, carrying an alpha channel across untouched.

    Once a piece has been remapped onto a cylinder its transparent corners are
    load-bearing — they are what stops it painting black wedges over its
    neighbours. The colour filters know nothing about that channel and would
    happily scale it, so hold it aside and put it back.
    """
    if img.mode != "RGBA" or flt.id in _ALPHA_NATIVE:
        return flt.apply(img, params)
    alpha = img.getchannel("A")
    out = flt.apply(img.convert("RGB"), params)
    if out.size != alpha.size:  # a resizing filter (rotate expands) — footprint lost
        return out.convert("RGBA")
    out = out.convert("RGB")
    out.putalpha(alpha)
    return out


def apply_ops(image: Image.Image, ops: list[dict[str, Any]]) -> Image.Image:
    """Run an ordered list of ``{"op": id, "params": {...}}`` through the pipeline."""
    out = image if image.mode == "RGBA" else image.convert("RGB")
    for op in ops:
        flt = FILTERS.get(op.get("op", ""))
        if flt is None:
            raise ValueError(f"unknown filter {op.get('op')!r}")
        out = _apply_keeping_alpha(flt, out, op.get("params") or {})
    return out


# ---------------------------------------------------------------------------
# Analysis registry (read-only inspectors)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Analysis:
    id: str
    label: str
    run: Callable[[Image.Image, dict[str, Any]], dict[str, Any]]


ANALYSES: dict[str, Analysis] = {}


def _register_analysis(a: Analysis) -> Analysis:
    ANALYSES[a.id] = a
    return a


def _ela(img: Image.Image, params: dict[str, Any]) -> dict[str, Any]:
    """Error Level Analysis — a *hint*, never a verdict (spec §6)."""
    quality = int(params.get("quality", 90))
    base = img.convert("RGB")
    buf = io.BytesIO()
    base.save(buf, "JPEG", quality=quality)
    buf.seek(0)
    resaved = Image.open(buf).convert("RGB")
    diff = ImageChops.difference(base, resaved)
    # diff is RGB, so getextrema() returns a (lo, hi) pair per band, not a single
    # pair — mypy only sees the grayscale overload here.
    peak = max((hi for _, hi in diff.getextrema()), default=1) or 1  # type: ignore[misc]
    amplified = ImageEnhance.Brightness(diff).enhance(255.0 / peak)
    out = io.BytesIO()
    amplified.save(out, "PNG")
    data = base64.b64encode(out.getvalue()).decode("ascii")
    return {
        "kind": "image",
        "data_url": f"data:image/png;base64,{data}",
        "note": "Bright, uneven patches can mean an edit, but texture and hard edges "
        "light up too, so it is a hint and not proof.",
    }


_register_analysis(Analysis("ela", "Error Level Analysis", _ela))


def registries() -> dict[str, Any]:
    """Machine-readable description of every filter and analysis (drives the UI)."""
    return {
        "filters": [f.schema() for f in FILTERS.values()],
        "analyses": [{"id": a.id, "label": a.label} for a in ANALYSES.values()],
    }


def run_analysis(
    case: Case,
    rel_path: str,
    name: str,
    params: dict[str, Any],
    *,
    time_s: float | None = None,
    ops: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Run a read-only analysis on a filed image or a transient frame recipe.

    ``time_s``/``ops`` let Inspect analyse a not-yet-saved frame
    (extracted from ``rel_path`` at ``time_s``, optionally adjusted) without filing
    anything.
    """
    analysis = ANALYSES.get(name)
    if analysis is None:
        raise ValueError(f"unknown analysis {name!r}")
    if time_s is None and not ops:
        with Image.open(case.resolve_inside(rel_path)) as img:
            return analysis.run(img, params or {})
    return analysis.run(_source_image(case, rel_path, time_s, ops), params or {})


# ---------------------------------------------------------------------------
# Video / probe helpers (ffmpeg + ffprobe)
# ---------------------------------------------------------------------------


def ffprobe_available() -> bool:
    return ffmpeg_engine.ffprobe_available()


def probe(case: Case, rel_path: str) -> dict[str, Any]:
    """Lightweight metadata for the viewer: kind, dimensions, duration, fps."""
    path = case.resolve_inside(rel_path)
    kind = media_engine.media_kind(path.name)
    info: dict[str, Any] = {"path": rel_path, "kind": kind, "filename": path.name}

    if kind == "image":
        with Image.open(path) as img:
            info.update(width=img.width, height=img.height, format=img.format, mode=img.mode)
        return info

    if kind == "video" and ffprobe_available():
        proc = subprocess.run(
            [ffmpeg_engine.ffprobe_exe(), "-v", "error", "-print_format", "json",
             "-show_format", "-show_streams", str(path)],
            capture_output=True, timeout=30,
        )
        if proc.returncode == 0:
            data = json.loads(proc.stdout or b"{}")
            stream: dict[str, Any] = next(
                (s for s in data.get("streams", []) if s.get("codec_type") == "video"), {}
            )
            info.update(
                width=stream.get("width"),
                height=stream.get("height"),
                duration=float(data.get("format", {}).get("duration", 0) or 0),
                fps=_parse_fps(stream.get("avg_frame_rate") or stream.get("r_frame_rate")),
                codec=stream.get("codec_name"),
            )
            info.update(_probe_extras(data, stream))
    return info


def _int_or_none(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _tag_text(value: Any) -> str | None:
    text = value.strip()[:120] if isinstance(value, str) else ""
    return text or None


def _rotation_of(stream: dict[str, Any]) -> int | None:
    """Degrees the player turns the picture by: the display matrix, else the old tag."""
    for side in stream.get("side_data_list") or []:
        if isinstance(side, dict) and "rotation" in side:
            try:
                return int(round(float(side["rotation"])))
            except (TypeError, ValueError):
                return None
    return _int_or_none((stream.get("tags") or {}).get("rotate"))


def _probe_extras(data: dict[str, Any], stream: dict[str, Any]) -> dict[str, Any]:
    """The facts the Info tab adds to a video, each absent when ffprobe has no answer."""
    fmt = data.get("format") or {}
    audio = next((s for s in data.get("streams", []) if s.get("codec_type") == "audio"), None)
    avg, real = _parse_fps(stream.get("avg_frame_rate")), _parse_fps(stream.get("r_frame_rate"))
    vfr = abs(avg - real) > 0.01 * max(avg, real) if avg and real else None
    encoder = _tag_text((fmt.get("tags") or {}).get("encoder")) or _tag_text(
        (stream.get("tags") or {}).get("encoder")
    )
    return {
        "bit_rate": _int_or_none(fmt.get("bit_rate")),
        "size": _int_or_none(fmt.get("size")),
        "audio": audio is not None,
        "audio_codec": audio.get("codec_name") if audio else None,
        "pix_fmt": stream.get("pix_fmt"),
        "rotation": _rotation_of(stream),
        "encoder": encoder,
        "vfr": vfr,
        "frames": _int_or_none(stream.get("nb_frames")),
    }


def _parse_fps(rate: str | None) -> float | None:
    if not rate or "/" not in rate:
        return None
    num, den = rate.split("/", 1)
    try:
        return round(float(num) / float(den), 3) if float(den) else None
    except (ValueError, ZeroDivisionError):
        return None


# A browser shows the frame whose interval *contains* the playhead, while ffmpeg's
# `-ss T` hands back the first frame whose pts is >= T. The page sends a frame's own
# timestamp, so the seek sits a hair under it: a timestamp rounded up by a rounding
# step (29.97 fps frames fall between milliseconds) must not land on the next frame.
FRAME_EPS = 1e-4

# Decoded frames kept for the adjust preview, which re-renders one frame as a slider
# moves; the decode is the slow part, so it is paid once. Bounded by pixels, not count.
# Eight 1080p frames, about 50 MB as RGB: room for the frames of one sitting.
FRAME_CACHE_PIXELS = 16_000_000
_frame_cache: OrderedDict[tuple[str, int, int, float], Image.Image] = OrderedDict()
_frame_cache_pixels = 0
_frame_cache_lock = threading.Lock()


def extract_frame(video_path: Path, time_s: float) -> Image.Image:
    """Decode a single frame at ``time_s`` seconds via ffmpeg (needs ffmpeg)."""
    if not media_engine.ffmpeg_available():
        raise RuntimeError("ffmpeg is required to extract video frames")
    seek = f"{max(time_s - FRAME_EPS, 0):.6f}"
    proc = subprocess.run(
        [ffmpeg_engine.ffmpeg_exe(), "-y", "-loglevel", "error", "-ss", seek,
         "-i", str(video_path), "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1"],
        capture_output=True, timeout=60,
    )
    if proc.returncode != 0 or not proc.stdout:
        raise ffmpeg_failed("read a frame of", proc.stderr)
    return Image.open(io.BytesIO(proc.stdout)).convert("RGB")


def frame_time_at(video_path: Path, time_s: float) -> float | None:
    """Timestamp of the frame a player *shows* at ``time_s``, or None when unknown.

    That is the frame whose interval contains the time: the latest one starting at
    or before it. Some browsers report the playback clock instead of a presented
    frame's own timestamp, so the page asks here. Only packet headers are read, no
    pixels are decoded, over a few seconds around the time. The answer is on the
    timeline ``-ss`` seeks on (the container's start offset taken off).
    """
    if not ffmpeg_engine.ffprobe_available():
        return None
    exe = ffmpeg_engine.ffprobe_exe()
    try:
        head = subprocess.run(
            [exe, "-v", "error", "-show_entries", "format=start_time", "-of", "csv=p=0", str(video_path)],
            capture_output=True, timeout=30,
        )
        start = float(head.stdout.decode().strip() or 0) if head.returncode == 0 else 0.0
        window = f"{max(time_s - 3, 0) + start:.6f}%{time_s + 1 + start:.6f}"
        proc = subprocess.run(
            [exe, "-v", "error", "-select_streams", "v:0", "-read_intervals", window,
             "-show_entries", "packet=pts_time", "-of", "csv=p=0", str(video_path)],
            capture_output=True, timeout=30,
        )
    except (OSError, subprocess.SubprocessError, ValueError):
        return None
    if proc.returncode != 0:
        return None
    times: list[float] = []
    for line in proc.stdout.decode("utf-8", "replace").splitlines():
        try:
            times.append(float(line.strip().rstrip(",")) - start)
        except ValueError:
            continue
    shown = [t for t in sorted(times) if t <= time_s + 1e-6]
    return round(max(shown[-1], 0.0), 6) if shown else None


def _cached_frame(video_path: Path, time_s: float) -> Image.Image:
    """``extract_frame`` through a small LRU; callers get a copy they may mutate."""
    global _frame_cache_pixels
    stat = video_path.stat()
    key = (str(video_path), stat.st_mtime_ns, stat.st_size, round(time_s, 6))
    with _frame_cache_lock:
        hit = _frame_cache.get(key)
        if hit is not None:
            _frame_cache.move_to_end(key)
            return hit.copy()
    img = extract_frame(video_path, time_s)
    pixels = img.width * img.height
    if pixels <= FRAME_CACHE_PIXELS:
        with _frame_cache_lock:
            if key not in _frame_cache:
                _frame_cache[key] = img.copy()
                _frame_cache_pixels += pixels
            while _frame_cache_pixels > FRAME_CACHE_PIXELS and _frame_cache:
                _, old = _frame_cache.popitem(last=False)
                _frame_cache_pixels -= old.width * old.height
    return img


def _sharpness(img: Image.Image) -> float:
    """Focus score for one image — see ``_focus_scores`` for the measure itself."""
    import numpy as np

    return _focus_score(np.asarray(img.convert("L"), dtype=np.uint8))


def _focus_score(gray) -> float:
    """Contrast-invariant focus: Laplacian variance normalised by image variance.

    Plain Laplacian variance is the classic focus measure, but it scales with the
    scene's *contrast* as well as its focus — so a blurry frame of a high-contrast
    subject (headlights at night, a bright sky) outscores a sharp frame of a flat
    one, and the "sharpest frames" come back soft. Contrast enters both variances
    quadratically, so dividing it out leaves a measure of focus alone.
    """
    import cv2
    import numpy as np

    arr = gray.astype(np.float64)
    spread = float(arr.var())
    if spread < 1e-6:  # a blank frame has no focus to speak of
        return 0.0
    lap = cv2.Laplacian(arr, cv2.CV_64F)
    return float(lap.var() / spread)


def _scan_size(width: int, height: int) -> tuple[int, int]:
    """Decode size for the scan: capped at ``SCAN_DIM``, even, aspect preserved."""
    longest = max(width, height)
    scale = min(1.0, SCAN_DIM / longest) if longest else 1.0
    w = max(2, int(round(width * scale)) & ~1)
    h = max(2, int(round(height * scale)) & ~1)
    return w, h


def _spread_picks(
    scored: list[dict[str, Any]], count: int, min_gap: float
) -> list[dict[str, Any]]:
    """Best-scoring frames, greedily thinned so no two picks sit within ``min_gap``.

    Neighbouring frames are near-identical, so an unfiltered top-N would hand back
    the same instant a dozen times. This keeps the best frame of each moment.
    """
    picks: list[dict[str, Any]] = []
    for item in sorted(scored, key=lambda d: d["score"], reverse=True):
        if len(picks) >= count:
            break
        if all(abs(item["time"] - p["time"]) >= min_gap for p in picks):
            picks.append(item)
    return picks


def _derivation(video_rel: str, sha: str | None, **extra: Any) -> dict[str, Any]:
    return {"type": "inspect", "from": video_rel, "from_sha256": sha, "at": _now(), **extra}


def _source_sha(case: Case, rel_path: str) -> str | None:
    entity = case.find_entity(attr="path", value=rel_path)
    return entity["attrs"].get("sha256") if entity else None


def _stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")


def _name_stem(label: str | None, fallback: str) -> str:
    """Filename stem for a filed item: the name the user typed, else the source's.

    The typed name is kept as typed, spaces included, so the file in the folder
    reads as the same thing the Media Library shows. Uploads have always kept
    their spaces, so nothing downstream is surprised by one.
    ``media_engine.safe_filename`` still scrubs what comes out of here, so this
    only has to collapse runs of whitespace and keep the stem short enough to read.
    """
    stem = re.sub(r"\s+", " ", (label or "").strip())
    return stem[:60] if stem else fallback[:40]


def _apply_meta(
    case: Case,
    result: dict[str, Any],
    *,
    label: str | None = None,
    folder: str | None = None,
    notes: str | None = None,
) -> None:
    """Write the name, folder and note chosen at Save to case onto the filed item.

    This applies to a deduped save too. Re-saving an unchanged collage lands on
    the same pixels and so on the same entity, and dropping the name there is
    exactly the case where a name the user just typed seems to vanish. The gate
    is an explicit act: the last one through it wins.
    """
    patch = {k: v for k, v in (("title", label), ("notes", notes)) if v}
    # An empty folder is the analyst choosing none, over the work folder the
    # registration filed the item in.
    if folder is not None:
        patch["folder"] = folder
    if patch:
        result["item"] = media_engine.update_media(case, result["item"]["path"], patch)


def scan_video(
    case: Case, video_rel: str, set_progress: Callable[[dict], None] | None = None
) -> dict[str, Any]:
    """Score *every* frame for focus and find the shot cuts — one ffmpeg pass, streamed.

    Returns ``{"frames": [{time, score}, ...], "cuts": [{time, score}, ...]}`` in
    playback order. Decoding the whole clip once and piping raw greyscale is what
    makes an exhaustive scan affordable: seeking to each frame with its own ffmpeg
    process (the old approach) costs a process spawn and a decode-from-keyframe
    *per frame*, which is why it could only ever afford to sample a handful. The
    cuts come from the same grey frames at no extra decode.

    A cut is measured the way ffmpeg's ``scdet`` does: the mean absolute difference
    to the previous frame, as a percentage of full scale, then the smaller of that
    and its change since the frame before. A hard cut spikes both; a fast pan or a
    flash spikes only one of them.
    """
    import cv2
    import numpy as np

    if not media_engine.ffmpeg_available():
        raise RuntimeError("ffmpeg is required to scan video frames")
    video_path = case.resolve_inside(video_rel)
    meta = probe(case, video_rel)
    fps = meta.get("fps") or 0
    duration = meta.get("duration") or 0
    if fps <= 0 or duration <= 0:
        raise RuntimeError("could not read video duration/fps (ffprobe needed)")

    w, h = _scan_size(int(meta.get("width") or 0), int(meta.get("height") or 0))
    expected = max(1, int(duration * fps))
    frame_bytes = w * h

    out: list[dict[str, Any]] = []
    cuts: list[dict[str, Any]] = []
    timed_out = threading.Event()
    with tempfile.TemporaryFile() as stderr_file:
        proc = subprocess.Popen(
            [ffmpeg_engine.ffmpeg_exe(), "-v", "error", "-i", str(video_path),
             "-vf", f"scale={w}:{h}", "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"],
            stdout=subprocess.PIPE, stderr=stderr_file,
        )

        def expire() -> None:
            timed_out.set()
            _stop_process(proc)

        timer = threading.Timer(_scan_timeout(duration), expire)
        timer.daemon = True
        timer.start()
        try:
            assert proc.stdout is not None
            index = 0
            prev: Any = None
            prev_mafd = 0.0
            last_cut = 0.0
            while True:
                buf = proc.stdout.read(frame_bytes)
                if not buf or len(buf) < frame_bytes:
                    break
                gray = np.frombuffer(buf, dtype=np.uint8).reshape(h, w)
                time_s = round(index / fps, 3)
                out.append({"time": time_s, "score": round(_focus_score(gray), 4)})
                if prev is not None:
                    mafd = float(cv2.absdiff(gray, prev).mean(dtype=np.float64)) * 100 / 255
                    score = min(max(min(mafd, abs(mafd - prev_mafd)), 0.0), 100.0)
                    if score > SHOT_THRESHOLD and time_s - last_cut >= MIN_SHOT_GAP:
                        cuts.append({"time": time_s, "score": round(score, 2)})
                        last_cut = time_s
                    prev_mafd = mafd
                prev = gray
                index += 1
                if set_progress and index % 25 == 0:
                    set_progress({"percent": round(min(99.0, index * 100 / expected), 1)})
        except BaseException:
            _stop_process(proc)
            raise
        finally:
            timer.cancel()
            if proc.stdout:
                proc.stdout.close()
            if proc.poll() is None:
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    _stop_process(proc)
            stderr_file.seek(0)
            err = stderr_file.read()
    if timed_out.is_set():
        raise RuntimeError("frame scan timed out")
    if proc.returncode not in (0, None):
        raise ffmpeg_failed("scan", err)
    if not out:
        raise ffmpeg_failed("decode any frame of", err)
    if set_progress:
        set_progress({"percent": 100.0})
    return {"frames": out, "cuts": cuts}


def _shots(scan: dict[str, Any], duration: float) -> list[dict[str, Any]]:
    """The shots between the cuts, each with its sharpest frame.

    Past ``SHOTS_CAP`` shots the weakest cuts are dropped, so the strongest
    boundaries survive and two short shots merge rather than a long one splitting.
    """
    cuts = scan["cuts"]
    if len(cuts) > SHOTS_CAP - 1:
        cuts = sorted(sorted(cuts, key=lambda c: c["score"], reverse=True)[: SHOTS_CAP - 1],
                      key=lambda c: c["time"])
    frames = scan["frames"]
    end_of_clip = max(duration, frames[-1]["time"]) if frames else duration
    starts = [0.0, *(c["time"] for c in cuts)]
    ends = [*starts[1:], end_of_clip]
    shots = []
    for start, end in zip(starts, ends):
        inside = [f for f in frames if start <= f["time"] < end] or frames[-1:]
        best = max(inside, key=lambda f: f["score"]) if inside else None
        shots.append({
            "start": round(start, 3), "end": round(end, 3),
            "best": best["time"] if best else start, "score": best["score"] if best else 0.0,
        })
    return shots


def suggest_frames(
    case: Case,
    video_rel: str,
    count: int = 12,
    min_gap: float | None = None,
    set_progress: Callable[[dict], None] | None = None,
) -> dict[str, Any]:
    """The sharpest frames in the clip, best first, and its shots (spec v2 gesture).

    Every frame is scored (``scan_video``), then the picks are thinned so they
    land on distinct moments — ``min_gap`` seconds apart, derived from the clip
    length when not given. The answer is kept beside the thumbnails, so reopening
    the video shows it again.
    """
    count = max(1, min(count, SUGGEST_CAP))
    scan = scan_video(case, video_rel, set_progress)
    scored = scan["frames"]
    span = scored[-1]["time"] if scored else 0.0
    if min_gap is None:
        # Enough to break up a burst of near-identical neighbours without
        # forcing picks away from a genuinely sharp stretch.
        min_gap = max(0.4, span / (count * 4)) if span else 0.0
    picks = _spread_picks(scored, count, min_gap)
    for rank, item in enumerate(picks):
        item["rank"] = rank
    result = {
        "frames": picks,
        "shots": _shots(scan, float(probe(case, video_rel).get("duration") or 0)),
    }
    _store_cache(case, video_rel, "scan", result)
    return result


# ---------------------------------------------------------------------------
# Video overview: hover thumbnails + waveform, cached beside the thumbnails
# ---------------------------------------------------------------------------
#
# The cache lives in the case's thumbnail directory, named after the file's content
# hash: it is left out of bundles, LRU-pruned and swept by `thumbnails.repair`, and
# losing any of it only costs a re-run.


def _video_cache_dir(case: Case) -> Path:
    path = case.subdir("media") / thumbnails.THUMB_DIR
    ensure_dir(path)
    return path


def _cache_names(case: Case, video_rel: str) -> dict[str, str]:
    """The cache file names for one video; only filed case media can have them."""
    if media_engine.media_kind(Path(video_rel).name) != "video":
        raise ValueError("only a video has an overview")
    item = media_engine.read_item(case, video_rel)
    sha = (item or {}).get("sha256")
    if not sha:
        raise CaseError("only media filed in the case can be inspected")
    return thumbnails.video_cache_names(sha)


def _write_cache_bytes(target: Path, data: bytes) -> None:
    tmp = target.with_name(f".{uuid.uuid4().hex}.tmp{target.suffix}")
    try:
        tmp.write_bytes(data)
        from ..workspace import _replace_with_retry

        _replace_with_retry(tmp, target)
    finally:
        tmp.unlink(missing_ok=True)


def _store_cache(case: Case, video_rel: str, which: str, payload: dict[str, Any]) -> None:
    """Write a scan or overview JSON; a video with no sidecar simply goes uncached."""
    try:
        names = _cache_names(case, video_rel)
    except (CaseError, ValueError):
        return
    _write_cache_bytes(
        _video_cache_dir(case) / names[which], json.dumps(payload).encode("utf-8")
    )
    thumbnails.prune_cache(case)


def _load_cache(case: Case, video_rel: str, which: str) -> dict[str, Any] | None:
    path = _video_cache_dir(case) / _cache_names(case, video_rel)[which]
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    os.utime(path)  # a hit is a use: keep it ahead of the LRU
    return data


def cached_scan(case: Case, video_rel: str) -> dict[str, Any] | None:
    """The last focus scan of this video, if its result is still cached."""
    return _load_cache(case, video_rel, "scan")


def cached_overview(case: Case, video_rel: str) -> dict[str, Any] | None:
    """The overview of this video if it, and its sprite, are still cached."""
    data = _load_cache(case, video_rel, "overview")
    if data is None:
        return None
    if data.get("tiles"):
        strip = _video_cache_dir(case) / _cache_names(case, video_rel)["strip"]
        if not strip.is_file():
            return None
        os.utime(strip)
    return data


def overview_strip(case: Case, video_rel: str) -> Path | None:
    """The tile sprite of this video, or None when it has not been made."""
    path = _video_cache_dir(case) / _cache_names(case, video_rel)["strip"]
    return path if path.is_file() else None


def _tile_height(meta: dict[str, Any]) -> int | None:
    """Tile height for a 160 px wide tile, from the *displayed* aspect (rotation applied)."""
    width, height = int(meta.get("width") or 0), int(meta.get("height") or 0)
    if width <= 0 or height <= 0:
        return None
    if abs(int(meta.get("rotation") or 0)) % 180 == 90:
        width, height = height, width
    return max(2, round(TILE_WIDTH * height / width) & ~1)


def _run_to_file(args: list[str], duration: float, what: str) -> None:
    """Run one ffmpeg that writes a file, with the scan's timeout and cleanup."""
    timed_out = threading.Event()
    with tempfile.TemporaryFile() as stderr_file:
        proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=stderr_file)

        def expire() -> None:
            timed_out.set()
            _stop_process(proc)

        timer = threading.Timer(_scan_timeout(duration), expire)
        timer.daemon = True
        timer.start()
        try:
            proc.wait()
        except BaseException:
            _stop_process(proc)
            raise
        finally:
            timer.cancel()
        stderr_file.seek(0)
        err = stderr_file.read()
    if timed_out.is_set():
        raise RuntimeError(f"the {what} timed out")
    if proc.returncode != 0:
        raise ffmpeg_failed(what, err)


def _make_tiles(video_path: Path, target: Path, duration: float, meta: dict[str, Any]) -> dict[str, Any] | None:
    """One JPEG sprite of ``n`` evenly spread tiles, from a keyframes-only decode.

    Skipping the non-key frames is what keeps this fast on a long video; ``fps``
    then repeats the nearest earlier keyframe to fill each slot. ``tpad`` first
    holds the last keyframe forever: ``fps`` cannot reach past the final frame it
    is given, so a clip with a single keyframe would otherwise yield nothing.
    """
    height = _tile_height(meta)
    if height is None:
        return None
    count = min(TILES_MAX, max(1, math.ceil(duration)))
    rows = math.ceil(count / TILE_COLUMNS)
    tmp = target.with_name(f".{uuid.uuid4().hex}.tmp.jpg")
    try:
        _run_to_file(
            [ffmpeg_engine.ffmpeg_exe(), "-y", "-v", "error", "-skip_frame", "nokey",
             "-i", str(video_path),
             "-vf", f"tpad=stop=-1:stop_mode=clone,fps={count}/{duration:.6f},scale={TILE_WIDTH}:{height},tile={TILE_COLUMNS}x{rows}",
             "-frames:v", "1", "-q:v", "4", str(tmp)],
            duration, "build thumbnails for",
        )
        if not tmp.is_file():
            raise RuntimeError("ffmpeg produced no thumbnails for this video")
        from ..workspace import _replace_with_retry

        _replace_with_retry(tmp, target)
    finally:
        tmp.unlink(missing_ok=True)
    return {
        "count": count, "columns": TILE_COLUMNS, "rows": rows,
        "width": TILE_WIDTH, "height": height, "interval": duration / count,
    }


def _waveform(video_path: Path, duration: float) -> list[float] | None:
    """Peak level of the first audio track in ``WAVEFORM_BUCKETS`` buckets, 0..1.

    The track is decoded to 8 kHz mono and read in chunks, each reduced to a peak
    per 20 samples before the next arrives, so an hour of sound costs a few MB
    rather than the 57 MB of its raw samples.
    """
    import numpy as np

    block = 20
    peaks: list[Any] = []
    carry = np.empty(0, dtype=np.int16)
    odd = b""
    timed_out = threading.Event()
    with tempfile.TemporaryFile() as stderr_file:
        proc = subprocess.Popen(
            [ffmpeg_engine.ffmpeg_exe(), "-v", "error", "-i", str(video_path), "-map", "0:a:0",
             "-ac", "1", "-ar", "8000", "-f", "s16le", "pipe:1"],
            stdout=subprocess.PIPE, stderr=stderr_file,
        )

        def expire() -> None:
            timed_out.set()
            _stop_process(proc)

        timer = threading.Timer(_scan_timeout(duration), expire)
        timer.daemon = True
        timer.start()
        try:
            assert proc.stdout is not None
            while True:
                chunk = proc.stdout.read(1 << 18)
                if not chunk:
                    break
                chunk = odd + chunk
                usable = len(chunk) & ~1
                odd = chunk[usable:]
                samples = np.concatenate([carry, np.frombuffer(chunk[:usable], dtype=np.int16)])
                whole = len(samples) // block * block
                if whole:
                    peaks.append(
                        np.abs(samples[:whole].astype(np.int32)).reshape(-1, block).max(axis=1)
                    )
                carry = samples[whole:]
        except BaseException:
            _stop_process(proc)
            raise
        finally:
            timer.cancel()
            if proc.stdout:
                proc.stdout.close()
            if proc.poll() is None:
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    _stop_process(proc)
            stderr_file.seek(0)
            err = stderr_file.read()
    if timed_out.is_set():
        raise RuntimeError("the waveform timed out")
    if proc.returncode not in (0, None):
        raise ffmpeg_failed("read the sound of", err)
    if len(carry):
        peaks.append(np.abs(carry.astype(np.int32)).max(keepdims=True))
    if not peaks:
        return None
    levels = np.concatenate(peaks)
    # Bucket i spans levels[i*L//B : (i+1)*L//B]; a short clip (L < B) repeats a
    # level, which reduceat does on its own when a bucket would be empty.
    starts = np.arange(WAVEFORM_BUCKETS) * len(levels) // WAVEFORM_BUCKETS
    buckets = np.maximum.reduceat(levels, starts)
    return [round(float(v) / 32768, 3) for v in buckets]


def video_overview(
    case: Case, video_rel: str, set_progress: Callable[[dict], None] | None = None
) -> dict[str, Any]:
    """Hover thumbnails and the waveform of a video, made once and cached.

    ``{"duration", "tiles": {count, columns, rows, width, height, interval} | None,
    "waveform": [..] | None}``; the sprite itself is served by ``overview_strip``.
    """
    cached = cached_overview(case, video_rel)
    if cached is not None:
        return cached
    if not media_engine.ffmpeg_available():
        raise RuntimeError("ffmpeg is required to build a video overview")
    names = _cache_names(case, video_rel)
    video_path = case.resolve_inside(video_rel)
    meta = probe(case, video_rel)
    duration = float(meta.get("duration") or 0)
    if duration <= 0:
        raise RuntimeError("could not read the video duration (ffprobe needed)")
    cache = _video_cache_dir(case)
    tiles = _make_tiles(video_path, cache / names["strip"], duration, meta)
    if set_progress:
        set_progress({"percent": 60.0})
    waveform = _waveform(video_path, duration) if meta.get("audio") else None
    result = {"duration": duration, "tiles": tiles, "waveform": waveform}
    _store_cache(case, video_rel, "overview", result)
    if set_progress:
        set_progress({"percent": 100.0})
    return result


# ---------------------------------------------------------------------------
# Recipes -> filed entities (Inspect's frames and video, Collage's export)
# ---------------------------------------------------------------------------
#
# Frames, adjustments and collage layouts are *recipes* (``{path, time?, ops[]}``),
# kept with a file's work or a collage (engine/inspectwork). No media enters the
# case until Save to case. These functions turn a recipe back into pixels and file
# the result — full-res and reproducible, so provenance stays honest (spec §6).


def _source_image(
    case: Case, rel_path: str, time_s: float | None = None, ops: list[dict[str, Any]] | None = None
) -> Image.Image:
    """Materialise a recipe into a PIL image (no filing).

    ``time_s`` set → decode that frame from the video ``rel_path``; otherwise open
    the image at ``rel_path``. ``ops`` (the adjust/crop pipeline) are applied last.
    """
    if time_s is not None:
        img = _cached_frame(case.resolve_inside(rel_path), time_s)
    else:
        img = Image.open(case.resolve_inside(rel_path))
        img.load()
    if ops:
        img = apply_ops(img, ops)
    return img


def render_preview(
    case: Case,
    rel_path: str,
    *,
    time_s: float | None = None,
    ops: list[dict[str, Any]] | None = None,
    fmt: str = "png",
) -> tuple[bytes, str]:
    """Render a recipe (video frame or image + ops) to ``(bytes, media_type)``, unfiled.

    Backs frame previews, collage pieces and rebuilding both when a work or a
    collage reopens. PNG keeps a remapped (panorama) piece's alpha, so the canvas
    shows the same curved footprint the export will paint; JPEG (the adjust
    preview, quality 90) is lighter and drops it.
    """
    img = _source_image(case, rel_path, time_s, ops)
    buf = io.BytesIO()
    if fmt == "jpeg":
        img.convert("RGB").save(buf, "JPEG", quality=90)
        return buf.getvalue(), "image/jpeg"
    if img.mode != "RGBA":
        img = img.convert("RGB")
    img.save(buf, "PNG")
    return buf.getvalue(), "image/png"


def save_frame(
    case: Case,
    rel_path: str,
    *,
    time_s: float | None = None,
    ops: list[dict[str, Any]] | None = None,
    label: str | None = None,
    folder: str | None = None,
    notes: str | None = None,
) -> dict[str, Any]:
    """File one frame (a video frame or an adjusted image) as case media."""
    image = _source_image(case, rel_path, time_s, ops)
    stem = _name_stem(label, Path(rel_path).stem)
    if time_s is not None:
        tag, op = f"_t{time_s:.2f}s", "frame"
    else:
        tag, op = "_edit", "adjust"
    # A named item keeps its name on disk, and nothing else: Inspect already
    # spells the instant into the name it sends, and `unique_path` settles a
    # collision, so a wall-clock stamp would only clutter the folder the analyst
    # opens. The timecode tag stands in on the fallback stem, where nothing else
    # says which instant this is.
    name = f"{stem}{'' if label else tag}.png"
    source = _derivation(
        rel_path, _source_sha(case, rel_path), op=op,
        **({"time": round(time_s, 3)} if time_s is not None else {}),
        **({"ops": ops} if ops else {}),
    )
    result = media_engine.import_image(case, image, name, source, by="inspect")
    _apply_meta(case, result, label=label, folder=folder, notes=notes)
    return result


def _solve_linear(matrix: list[list[float]], rhs: list[float]) -> list[float]:
    """Gaussian elimination with partial pivoting (small square systems, no numpy)."""
    n = len(rhs)
    a = [row[:] + [rhs[i]] for i, row in enumerate(matrix)]
    for col in range(n):
        pivot = max(range(col, n), key=lambda r: abs(a[r][col]))
        if abs(a[pivot][col]) < 1e-12:
            raise ValueError("degenerate perspective quad")
        a[col], a[pivot] = a[pivot], a[col]
        pv = a[col][col]
        a[col] = [v / pv for v in a[col]]
        for r in range(n):
            if r != col and a[r][col]:
                factor = a[r][col]
                a[r] = [v - factor * a[col][i] for i, v in enumerate(a[r])]
    return [a[i][n] for i in range(n)]


def _perspective_coeffs(dst_quad: list[list[float]], src_quad: list[list[float]]) -> list[float]:
    """8 coeffs for ``Image.transform(PERSPECTIVE)`` mapping ``dst_quad``→``src_quad``.

    PIL samples the *output* pixel and needs the matching *input* coordinate, so we
    solve for the map from destination (canvas) corners to source-image corners.
    """
    matrix: list[list[float]] = []
    rhs: list[float] = []
    for (x, y), (u, v) in zip(dst_quad, src_quad):
        matrix.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        matrix.append([0, 0, 0, x, y, 1, -v * x, -v * y])
        rhs.extend((u, v))
    return _solve_linear(matrix, rhs)


def _compose_canvas(
    case: Case,
    *,
    width: int,
    height: int,
    nodes: list[dict[str, Any]],
    background: str | None,
) -> tuple[Image.Image, list[str]]:
    """Warp each node's source into its quad and paint onto one canvas."""
    if not nodes:
        raise ValueError("collage needs at least one image")
    width = max(16, min(int(width), 8192))
    height = max(16, min(int(height), 8192))
    canvas = (
        Image.new("RGB", (width, height), background)
        if background
        else Image.new("RGBA", (width, height), (0, 0, 0, 0))
    )

    sources: list[str] = []
    for node in nodes:
        spec = node.get("src") or {}
        rel = spec.get("path")
        if not rel:
            raise ValueError("collage node is missing a source path")
        img = _source_image(case, rel, spec.get("time"), spec.get("ops"))
        # A piece remapped onto a panorama's cylinder arrives with its footprint in
        # the alpha channel — paint through that rather than over it, or its
        # transparent corners land as black wedges on the neighbour underneath.
        footprint = img.getchannel("A") if img.mode == "RGBA" else Image.new("L", img.size, 255)
        img = img.convert("RGB")
        w, h = img.size
        src_corners = [[0.0, 0.0], [float(w), 0.0], [float(w), float(h)], [0.0, float(h)]]
        quad = [[float(x), float(y)] for x, y in node["quad"]]
        coeffs = _perspective_coeffs(quad, src_corners)
        warped = img.transform(
            (width, height), Image.Transform.PERSPECTIVE, coeffs, Image.Resampling.BICUBIC
        )
        mask = footprint.transform(
            (width, height), Image.Transform.PERSPECTIVE, coeffs, Image.Resampling.BILINEAR
        )
        canvas.paste(warped, (0, 0), mask)
        sources.append(rel)
    return canvas, sources


def compose_perspective(
    case: Case,
    *,
    width: int,
    height: int,
    nodes: list[dict[str, Any]],
    background: str | None = "#12141c",
    label: str | None = None,
    folder: str | None = None,
    notes: str | None = None,
) -> dict[str, Any]:
    """Composite frames and case images, each warped into a 4-point quad, onto a canvas.

    ``nodes`` are painted in order (later = on top); each is
    ``{"src": {path, time?, ops[]}, "quad": [[x,y]×4]}`` with the quad in canvas
    pixels (top-left, top-right, bottom-right, bottom-left). A falsy ``background``
    yields a transparent (RGBA) canvas so the saved PNG carries only the pieces.
    """
    canvas, sources = _compose_canvas(
        case, width=width, height=height, nodes=nodes, background=background
    )
    source = _derivation("", None, op="collage", sources=sources, perspective=True)
    name = f"{_name_stem(label, 'collage')}.png"
    result = media_engine.import_image(case, canvas, name, source, by="inspect")
    _apply_meta(case, result, label=label, folder=folder, notes=notes)
    return result


STITCH_MODES = ("planar", *stitch.WARPS)


def solve_collage_layout(
    case: Case, *, srcs: list[dict[str, Any]], width: int, height: int, mode: str = "planar"
) -> dict[str, Any]:
    """Auto-stitch: solve each piece's placement from the imagery itself (no filing).

    ``srcs`` are the same ``{path, time?, ops[]}`` recipes the collage already
    speaks, so pieces stitch *as adjusted* — what the analyst sees is what gets
    matched. The returned quads are canvas pixels, ready to drop onto the canvas
    as ordinary pieces; ``dropped`` lists the pieces that matched nothing, which
    the caller leaves where they were.

    ``mode`` picks the projection (see :mod:`azimut.engine.stitch`). ``planar``
    returns quads alone — the pieces keep their pixels and stay hand-warpable. The
    panorama modes also return a per-piece ``op``: the remap to append to that
    piece's recipe, which is how the warp survives to the full-res export. Callers
    must hand in *un-remapped* recipes; a cylinder is not a pinhole view, so
    solving cameras from already-warped pixels would measure the wrong scene.

    ``width`` and ``height`` are the caller's current canvas, and ``canvas`` in the
    answer is the one the quads are expressed in: the solver grows it to whatever
    the stitch is worth in source pixels rather than shrinking the stitch to fit.
    The caller resizes its canvas to match, or the detail is lost on the way back.
    """
    if mode not in STITCH_MODES:
        raise ValueError(f"unknown panorama mode {mode!r}")
    images = [
        _source_image(case, s["path"], s.get("time"), s.get("ops")) for s in srcs
    ]
    try:
        if mode == "planar":
            solved = stitch.solve_layout(images, width=width, height=height)
        else:
            solved = stitch.solve_rotation_layout(images, width=width, height=height, warp=mode)
    finally:
        for img in images:
            img.close()
    remaps = solved.get("remaps") or {}
    return {
        "mode": mode,
        "nodes": [
            {
                "index": i,
                "quad": q,
                "op": ({"op": "remap", "params": remaps[i]} if i in remaps else None),
            }
            for i, q in sorted(solved["quads"].items())
        ],
        "dropped": solved["dropped"],
        "canvas": solved["canvas"],
    }


# Map the frontend's css-filter values (multiplicative, 1.0 = neutral) to ffmpeg's
# `eq` filter, whose brightness is additive. Only the css-previewable filters carry
# over to video; grayscale/invert are handled as saturation/negate.
def _eq_filterchain(params: dict[str, Any]) -> str | None:
    def val(key, default):
        try:
            return float(params.get(key, default))
        except (TypeError, ValueError):
            return default

    eq = {
        "brightness": round(val("brightness", 1.0) - 1.0, 4),
        "contrast": round(val("contrast", 1.0), 4),
        "saturation": 0.0 if val("grayscale", 0) >= 1 else round(val("saturation", 1.0), 4),
        "gamma": round(val("gamma", 1.0), 4),
    }
    neutral = {"brightness": 0.0, "contrast": 1.0, "saturation": 1.0, "gamma": 1.0}
    parts = [f"eq={':'.join(f'{k}={v}' for k, v in eq.items())}"] if eq != neutral else []
    if val("invert", 0) >= 1:
        parts.append("negate")
    return ",".join(parts) or None


def _rotation_filterchain(rotation: int) -> str | None:
    """Map the UI's clockwise degrees to ffmpeg right-angle filters."""
    chains = {
        -180: "hflip,vflip",
        -90: "transpose=cclock",
        0: None,
        90: "transpose=clock",
        180: "hflip,vflip",
    }
    if rotation not in chains:
        raise ValueError("video rotation must be -180, -90, 0, 90 or 180 degrees")
    return chains[rotation]


def _video_filterchain(params: dict[str, Any], rotation: int) -> str | None:
    parts = (_rotation_filterchain(rotation), _eq_filterchain(params))
    return ",".join(part for part in parts if part) or None


def enhance_video(
    case: Case,
    video_rel: str,
    params: dict[str, Any],
    *,
    rotation: int = 0,
    label: str | None = None,
    folder: str | None = None,
    notes: str | None = None,
) -> dict[str, Any]:
    """Re-encode a video with its adjustments and orientation, then file it."""
    if not media_engine.ffmpeg_available():
        raise RuntimeError("ffmpeg is required to enhance video")
    vf = _video_filterchain(params, rotation)
    if not vf:
        raise ValueError("no adjustments or rotation to apply")

    src = case.resolve_inside(video_rel)
    stem = _name_stem(label, Path(src.name).stem)
    tmp = case.subdir("media") / f".enhance_{_stamp()}.mp4"
    try:
        proc = subprocess.run(
            [ffmpeg_engine.ffmpeg_exe(), "-y", "-loglevel", "error", "-i", str(src),
             "-vf", vf, "-c:a", "copy", "-metadata:s:v:0", "rotate=0", str(tmp)],
            capture_output=True, timeout=600,
        )
        if proc.returncode != 0 or not tmp.exists():
            raise ffmpeg_failed("enhance", proc.stderr)
        name = f"{stem}{'' if label else '_enhanced'}.mp4"
        source = _derivation(
            video_rel, _source_sha(case, video_rel), op="enhance-video",
            params=params, rotation=rotation,
        )
        result = media_engine.import_produced_file(case, tmp, name, source, by="inspect")
    finally:
        tmp.unlink(missing_ok=True)
    _apply_meta(case, result, label=label, folder=folder, notes=notes)
    return result
