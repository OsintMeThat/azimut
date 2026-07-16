"""Media inspection engine: open a photo or video, pull frames, adjust and
analyse imagery — all locally, Pillow + ffmpeg only (spec §7).

Two self-describing registries make new mini-tools cheap to add (the whole point
of this module's design):

* ``FILTERS`` — pixel transforms applied as an ordered pipeline. Each declares a
  parameter schema and an optional CSS hint so the frontend can live-preview
  without a round-trip. Adding an adjustment = one ``@filter`` function.
* ``ANALYSES`` — read-only inspectors that return one of a small set of render
  kinds (``keyvalue`` / ``histogram`` / ``image`` / ``text``). The frontend has a
  generic renderer per kind, so adding an analysis = one ``@analysis`` function.

Everything the tools produce is filed back as ordinary case media (via the media
engine) with provenance recording how it was derived — honest, auditable output
(spec §6). Nothing here mutates the original media.
"""

from __future__ import annotations

import base64
import io
import json
import shutil
import subprocess
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from PIL import Image, ImageChops, ImageEnhance, ImageOps
from PIL.ExifTags import GPSTAGS, TAGS

from ..workspace import Case
from . import media as media_engine
from . import stitch

SUGGEST_CAP = 60  # hard cap on how many "sharpest frame" suggestions we return

# The sharpest-frame scan reads *every* frame in one ffmpeg pass, decoded to
# greyscale at this max dimension. Full resolution buys no discrimination for a
# focus measure but costs real time; this is small enough to stream a long clip
# and large enough to tell a sharp frame from a soft one.
SCAN_DIM = 480


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------------------
# Filter registry (pixel-transform pipeline)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Param:
    name: str
    label: str
    type: str = "range"  # 'range' | 'toggle'
    min: float = 0.0
    max: float = 2.0
    step: float = 0.01
    default: float = 1.0
    unit: str = ""


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
            "params": [vars(p) for p in self.params],
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


def apply_ops(image: Image.Image, ops: list[dict[str, Any]]) -> Image.Image:
    """Run an ordered list of ``{"op": id, "params": {...}}`` through the pipeline."""
    out = image.convert("RGB")
    for op in ops:
        flt = FILTERS.get(op.get("op"))
        if flt is None:
            raise ValueError(f"unknown filter {op.get('op')!r}")
        out = flt.apply(out, op.get("params") or {})
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


def _histogram(img: Image.Image, params: dict[str, Any]) -> dict[str, Any]:
    rgb = img.convert("RGB")
    hist = rgb.histogram()
    return {
        "kind": "histogram",
        "channels": {"r": hist[0:256], "g": hist[256:512], "b": hist[512:768]},
    }


def _exif(img: Image.Image, params: dict[str, Any]) -> dict[str, Any]:
    rows: dict[str, str] = {
        "Format": img.format or "—",
        "Mode": img.mode,
        "Size": f"{img.width} × {img.height}",
    }
    exif = img.getexif()
    for tag_id, value in exif.items():
        name = TAGS.get(tag_id, str(tag_id))
        if name == "GPSInfo":
            gps = {GPSTAGS.get(k, str(k)): v for k, v in exif.get_ifd(tag_id).items()}
            if gps:
                rows["GPS"] = ", ".join(f"{k}={v}" for k, v in gps.items())
            continue
        text = str(value)
        rows[name] = text[:120] + "…" if len(text) > 120 else text
    return {"kind": "keyvalue", "rows": rows}


def _ela(img: Image.Image, params: dict[str, Any]) -> dict[str, Any]:
    """Error Level Analysis — a *hint*, never a verdict (spec §6)."""
    quality = int(params.get("quality", 90))
    base = img.convert("RGB")
    buf = io.BytesIO()
    base.save(buf, "JPEG", quality=quality)
    buf.seek(0)
    resaved = Image.open(buf).convert("RGB")
    diff = ImageChops.difference(base, resaved)
    peak = max((hi for _, hi in diff.getextrema()), default=1) or 1
    amplified = ImageEnhance.Brightness(diff).enhance(255.0 / peak)
    out = io.BytesIO()
    amplified.save(out, "PNG")
    data = base64.b64encode(out.getvalue()).decode("ascii")
    return {
        "kind": "image",
        "data_url": f"data:image/png;base64,{data}",
        "note": "Error Level Analysis is a tampering *hint*, not proof. "
        "Bright, uneven regions can indicate edits — or just texture and edges.",
    }


_register_analysis(Analysis("histogram", "Histogram", _histogram))
_register_analysis(Analysis("exif", "EXIF & metadata", _exif))
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

    ``time_s``/``ops`` let the Inspect session analyse a not-yet-saved frame
    (extracted from ``rel_path`` at ``time_s``, optionally adjusted) without filing
    anything. Plain image analysis (no ``time_s``/``ops``) keeps the original file
    open so metadata analyses (EXIF) still see it.
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
    return shutil.which("ffprobe") is not None


def probe(case: Case, rel_path: str) -> dict[str, Any]:
    """Lightweight metadata for the viewer: kind, dimensions, duration, fps."""
    path = case.resolve_inside(rel_path)
    kind = media_engine.media_kind(path.name)
    info: dict[str, Any] = {"path": rel_path, "kind": kind, "filename": path.name}

    if kind == "image":
        with Image.open(path) as img:
            info.update(width=img.width, height=img.height)
        return info

    if kind == "video" and ffprobe_available():
        proc = subprocess.run(
            ["ffprobe", "-v", "error", "-print_format", "json",
             "-show_format", "-show_streams", str(path)],
            capture_output=True, timeout=30,
        )
        if proc.returncode == 0:
            data = json.loads(proc.stdout or b"{}")
            stream = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), {})
            info.update(
                width=stream.get("width"),
                height=stream.get("height"),
                duration=float(data.get("format", {}).get("duration", 0) or 0),
                fps=_parse_fps(stream.get("avg_frame_rate") or stream.get("r_frame_rate")),
                codec=stream.get("codec_name"),
            )
    return info


def _parse_fps(rate: str | None) -> float | None:
    if not rate or "/" not in rate:
        return None
    num, den = rate.split("/", 1)
    try:
        return round(float(num) / float(den), 3) if float(den) else None
    except (ValueError, ZeroDivisionError):
        return None


def extract_frame(video_path: Path, time_s: float) -> Image.Image:
    """Decode a single frame at ``time_s`` seconds via ffmpeg (needs ffmpeg)."""
    if not media_engine.ffmpeg_available():
        raise RuntimeError("ffmpeg is required to extract video frames")
    proc = subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{max(time_s, 0):.3f}",
         "-i", str(video_path), "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1"],
        capture_output=True, timeout=60,
    )
    if proc.returncode != 0 or not proc.stdout:
        raise RuntimeError((proc.stderr or b"").decode("utf-8", "replace").strip() or "frame decode failed")
    return Image.open(io.BytesIO(proc.stdout)).convert("RGB")


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


def capture_frame(case: Case, video_rel: str, time_s: float, label: str | None = None) -> dict[str, Any]:
    """Extract one frame and file it as case media."""
    video_path = case.resolve_inside(video_rel)
    frame = extract_frame(video_path, time_s)
    stem = Path(video_path.name).stem[:40]
    name = f"{stem}_t{time_s:.2f}s_{_stamp()}.png"
    source = _derivation(video_rel, _source_sha(case, video_rel), op="frame", time=round(time_s, 3))
    result = media_engine.import_image(case, frame, name, source, by="inspect")
    if label and not result.get("duplicate"):
        media_engine.update_media(case, result["item"]["path"], {"label": label})
    return result


def scan_focus(
    case: Case, video_rel: str, set_progress: Callable[[dict], None] | None = None
) -> list[dict[str, Any]]:
    """Score *every* frame of the video for focus — one ffmpeg pass, streamed.

    Returns ``[{time, score}, ...]`` in playback order. Decoding the whole clip
    once and piping raw greyscale is what makes an exhaustive scan affordable:
    seeking to each frame with its own ffmpeg process (the old approach) costs a
    process spawn and a decode-from-keyframe *per frame*, which is why it could
    only ever afford to sample a handful.
    """
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

    proc = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-i", str(video_path),
         "-vf", f"scale={w}:{h}", "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    out: list[dict[str, Any]] = []
    try:
        assert proc.stdout is not None
        index = 0
        while True:
            buf = proc.stdout.read(frame_bytes)
            if not buf or len(buf) < frame_bytes:
                break
            gray = np.frombuffer(buf, dtype=np.uint8).reshape(h, w)
            out.append({"time": round(index / fps, 3), "score": round(_focus_score(gray), 4)})
            index += 1
            if set_progress and index % 25 == 0:
                set_progress({"percent": round(min(99.0, index * 100 / expected), 1)})
    finally:
        if proc.stdout:
            proc.stdout.close()
        err = proc.stderr.read() if proc.stderr else b""
        if proc.stderr:
            proc.stderr.close()
        proc.wait()
    if not out:
        raise RuntimeError(
            (err or b"").decode("utf-8", "replace").strip() or "frame scan decoded nothing"
        )
    if set_progress:
        set_progress({"percent": 100.0})
    return out


def suggest_frames(
    case: Case,
    video_rel: str,
    count: int = 12,
    min_gap: float | None = None,
    set_progress: Callable[[dict], None] | None = None,
) -> list[dict[str, Any]]:
    """The sharpest frames in the clip, best first (spec v2 gesture).

    Every frame is scored (``scan_focus``), then the picks are thinned so they
    land on distinct moments — ``min_gap`` seconds apart, derived from the clip
    length when not given.
    """
    count = max(1, min(count, SUGGEST_CAP))
    scored = scan_focus(case, video_rel, set_progress)
    span = scored[-1]["time"] if scored else 0.0
    if min_gap is None:
        # Enough to break up a burst of near-identical neighbours without
        # forcing picks away from a genuinely sharp stretch.
        min_gap = max(0.4, span / (count * 4)) if span else 0.0
    picks = _spread_picks(scored, count, min_gap)
    for rank, item in enumerate(picks):
        item["rank"] = rank
    return picks


# ---------------------------------------------------------------------------
# Adjustments & collage (operate on images / captured frames)
# ---------------------------------------------------------------------------


def bake(case: Case, rel_path: str, ops: list[dict[str, Any]], label: str | None = None) -> dict[str, Any]:
    """Apply an adjustment pipeline to an image and file the result as new media."""
    with Image.open(case.resolve_inside(rel_path)) as img:
        rendered = apply_ops(img, ops)
    stem = Path(rel_path).stem[:40]
    name = f"{stem}_edit_{_stamp()}.png"
    source = _derivation(rel_path, _source_sha(case, rel_path), op="adjust", ops=ops)
    result = media_engine.import_image(case, rendered, name, source, by="inspect")
    if label and not result.get("duplicate"):
        media_engine.update_media(case, result["item"]["path"], {"label": label})
    return result


def collage(
    case: Case,
    rel_paths: list[str],
    *,
    columns: int = 2,
    gap: int = 8,
    background: str = "#12141c",
    cell: int = 480,
    label: str | None = None,
) -> dict[str, Any]:
    """Assemble several images into a contact-sheet / collage (one derivative)."""
    if not rel_paths:
        raise ValueError("collage needs at least one image")
    columns = max(1, min(columns, len(rel_paths)))
    cell = max(64, min(cell, 1024))
    gap = max(0, min(gap, 64))

    tiles: list[Image.Image] = []
    for rel in rel_paths:
        with Image.open(case.resolve_inside(rel)) as img:
            thumb = img.convert("RGB")
            thumb.thumbnail((cell, cell))
            tiles.append(thumb)

    rows = (len(tiles) + columns - 1) // columns
    width = columns * cell + (columns + 1) * gap
    height = rows * cell + (rows + 1) * gap
    canvas = Image.new("RGB", (width, height), background)

    for idx, tile in enumerate(tiles):
        r, c = divmod(idx, columns)
        cx = gap + c * (cell + gap) + (cell - tile.width) // 2
        cy = gap + r * (cell + gap) + (cell - tile.height) // 2
        canvas.paste(tile, (cx, cy))

    source = _derivation("", None, op="collage", sources=rel_paths, columns=columns)
    name = f"collage_{_stamp()}.png"
    result = media_engine.import_image(case, canvas, name, source, by="inspect")
    if label and not result.get("duplicate"):
        media_engine.update_media(case, result["item"]["path"], {"label": label})
    return result


# ---------------------------------------------------------------------------
# Session workspace: recipes -> filed entities (Inspect Selection/Frame/Collage/Save)
# ---------------------------------------------------------------------------
#
# The Inspect UI is a scratch workspace: frames, adjustments and a collage layout
# live in the browser as *recipes* (``{path, time?, ops[]}``) and nothing enters the
# case until an explicit Save. These functions turn a recipe back into pixels and
# file the result — full-res and reproducible, so provenance stays honest (spec §6).


def _source_image(
    case: Case, rel_path: str, time_s: float | None = None, ops: list[dict[str, Any]] | None = None
) -> Image.Image:
    """Materialise a recipe into a PIL image (no filing).

    ``time_s`` set → decode that frame from the video ``rel_path``; otherwise open
    the image at ``rel_path``. ``ops`` (the adjust/crop pipeline) are applied last.
    """
    if time_s is not None:
        img = extract_frame(case.resolve_inside(rel_path), time_s)
    else:
        img = Image.open(case.resolve_inside(rel_path))
        img.load()
    if ops:
        img = apply_ops(img, ops)
    return img


def preview_frame_png(case: Case, video_rel: str, time_s: float) -> bytes:
    """Decode one video frame and return PNG bytes — for the transient tray only."""
    frame = extract_frame(case.resolve_inside(video_rel), time_s)
    buf = io.BytesIO()
    frame.save(buf, "PNG")
    return buf.getvalue()


def render_preview_png(
    case: Case, rel_path: str, *, time_s: float | None = None, ops: list[dict[str, Any]] | None = None
) -> bytes:
    """Render a recipe (video frame or image + ops) to PNG bytes — no filing.

    Backs collage snapshots and rebuilding previews when a saved session reopens.
    """
    buf = io.BytesIO()
    _source_image(case, rel_path, time_s, ops).convert("RGB").save(buf, "PNG")
    return buf.getvalue()


def save_frame(
    case: Case,
    rel_path: str,
    *,
    time_s: float | None = None,
    ops: list[dict[str, Any]] | None = None,
    label: str | None = None,
    folder: str | None = None,
) -> dict[str, Any]:
    """File one tray frame (a video frame or an adjusted image) as case media."""
    image = _source_image(case, rel_path, time_s, ops)
    stem = Path(rel_path).stem[:40]
    if time_s is not None:
        tag, op = f"_t{time_s:.2f}s", "frame"
    else:
        tag, op = "_edit", "adjust"
    name = f"{stem}{tag}_{_stamp()}.png"
    source = _derivation(
        rel_path, _source_sha(case, rel_path), op=op,
        **({"time": round(time_s, 3)} if time_s is not None else {}),
        **({"ops": ops} if ops else {}),
    )
    result = media_engine.import_image(case, image, name, source, by="inspect")
    if not result.get("duplicate"):
        patch: dict[str, Any] = {}
        if label:
            patch["label"] = label
        if folder:
            patch["folder"] = folder
        if patch:
            media_engine.update_media(case, result["item"]["path"], patch)
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
    matrix, rhs = [], []
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
    scale: float = 1.0,
) -> tuple[Image.Image, list[str]]:
    """Warp each node's source into its quad and paint onto one canvas.

    Shared by the filed export and the (unsaved) Save-tab preview. ``scale``
    shrinks the whole layout (canvas + quads) for a cheaper preview render.
    """
    if not nodes:
        raise ValueError("collage needs at least one image")
    width = max(16, min(int(round(width * scale)), 8192))
    height = max(16, min(int(round(height * scale)), 8192))
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
        img = _source_image(case, rel, spec.get("time"), spec.get("ops")).convert("RGB")
        w, h = img.size
        src_corners = [[0, 0], [w, 0], [w, h], [0, h]]
        quad = [[float(x) * scale, float(y) * scale] for x, y in node["quad"]]
        coeffs = _perspective_coeffs(quad, src_corners)
        warped = img.transform((width, height), Image.PERSPECTIVE, coeffs, Image.BICUBIC)
        mask = Image.new("L", (w, h), 255).transform(
            (width, height), Image.PERSPECTIVE, coeffs, Image.BICUBIC
        )
        canvas.paste(warped, (0, 0), mask)
        sources.append(rel)
    return canvas, sources


def compose_preview_png(
    case: Case,
    *,
    width: int,
    height: int,
    nodes: list[dict[str, Any]],
    background: str | None = None,
    max_dim: int = 640,
) -> bytes:
    """Render the exact composited collage to PNG bytes — nothing is filed.

    Same warp as :func:`compose_perspective`, downscaled to ``max_dim`` so the
    Save tab can show a true-to-export thumbnail cheaply.
    """
    scale = min(1.0, max_dim / max(1, max(int(width), int(height))))
    canvas, _ = _compose_canvas(
        case, width=width, height=height, nodes=nodes, background=background, scale=scale
    )
    buf = io.BytesIO()
    canvas.save(buf, "PNG")
    return buf.getvalue()


def compose_perspective(
    case: Case,
    *,
    width: int,
    height: int,
    nodes: list[dict[str, Any]],
    background: str | None = "#12141c",
    label: str | None = None,
    folder: str | None = None,
) -> dict[str, Any]:
    """Composite tray/case images, each warped into a 4-point quad, onto a canvas.

    ``nodes`` are painted in order (later = on top); each is
    ``{"src": {path, time?, ops[]}, "quad": [[x,y]×4]}`` with the quad in canvas
    pixels (top-left, top-right, bottom-right, bottom-left). A falsy ``background``
    yields a transparent (RGBA) canvas so the saved PNG carries only the pieces.
    """
    canvas, sources = _compose_canvas(
        case, width=width, height=height, nodes=nodes, background=background
    )
    source = _derivation("", None, op="collage", sources=sources, perspective=True)
    name = f"collage_{_stamp()}.png"
    result = media_engine.import_image(case, canvas, name, source, by="inspect")
    if not result.get("duplicate"):
        patch: dict[str, Any] = {}
        if label:
            patch["label"] = label
        if folder:
            patch["folder"] = folder
        if patch:
            media_engine.update_media(case, result["item"]["path"], patch)
    return result


def solve_collage_layout(
    case: Case, *, srcs: list[dict[str, Any]], width: int, height: int
) -> dict[str, Any]:
    """Auto-stitch: solve each piece's quad from the imagery itself (no filing).

    ``srcs`` are the same ``{path, time?, ops[]}`` recipes the collage already
    speaks, so pieces stitch *as adjusted* — what the analyst sees is what gets
    matched. The returned quads are canvas pixels, ready to drop onto the canvas
    as ordinary (still hand-tunable) pieces; ``dropped`` lists the pieces that
    matched nothing, which the caller leaves where they were.
    """
    images = [
        _source_image(case, s["path"], s.get("time"), s.get("ops")) for s in srcs
    ]
    try:
        solved = stitch.solve_layout(images, width=width, height=height)
    finally:
        for img in images:
            img.close()
    return {
        "nodes": [{"index": i, "quad": q} for i, q in sorted(solved["quads"].items())],
        "dropped": solved["dropped"],
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


def enhance_video(
    case: Case,
    video_rel: str,
    params: dict[str, Any],
    *,
    label: str | None = None,
    folder: str | None = None,
) -> dict[str, Any]:
    """Re-encode a video with the gear's adjustments and file it as new media."""
    if not media_engine.ffmpeg_available():
        raise RuntimeError("ffmpeg is required to enhance video")
    vf = _eq_filterchain(params)
    if not vf:
        raise ValueError("no adjustments to apply — tune the gear first")

    src = case.resolve_inside(video_rel)
    stem = Path(src.name).stem[:40]
    tmp = case.subdir("media") / f".enhance_{_stamp()}.mp4"
    try:
        proc = subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", str(src),
             "-vf", vf, "-c:a", "copy", str(tmp)],
            capture_output=True, timeout=600,
        )
        if proc.returncode != 0 or not tmp.exists():
            raise RuntimeError(
                (proc.stderr or b"").decode("utf-8", "replace").strip() or "video enhance failed"
            )
        name = f"{stem}_enhanced_{_stamp()}.mp4"
        source = _derivation(video_rel, _source_sha(case, video_rel), op="enhance-video", params=params)
        result = media_engine.import_produced_file(case, tmp, name, source, by="inspect")
    finally:
        tmp.unlink(missing_ok=True)
    if not result.get("duplicate"):
        patch: dict[str, Any] = {}
        if label:
            patch["label"] = label
        if folder:
            patch["folder"] = folder
        if patch:
            media_engine.update_media(case, result["item"]["path"], patch)
    return result
