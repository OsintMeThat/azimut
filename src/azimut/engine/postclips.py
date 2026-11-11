"""What a video thread files for its posts: the clip cut for a post, one passage of a
proof's ★ video as a case file of its own, and the thread's contact sheet.

A video thread posts the video a proof is about, and a long clip is past what a
platform takes, or simply too long to watch for one place. The analyst cuts the
passage where the place shows into a short video of its own, filed in Media like any
file Inspect makes, and the proof's scene keeps it as ``clip`` (`scenes.read_clip`):
``{path, start, end}``, the file and the passage it was cut from.

**Re-encoded, never copied.** A stream copy is instant but can only start on a
keyframe, so the clip would open seconds before the passage or on frozen frames, and
it keeps the source's codec, which may be one a platform refuses (HEVC, VP9, AV1, 10-bit
colour). The cut is decoded from the keyframe before the start and re-encoded from the
exact frame, as H.264 High in 4:2:0 with AAC-LC stereo and the index at the front: what
X and Bluesky both ask for. The size is the source's, down to 1920 on the long side and
never up; the rate at most 60 frames a second, X's ceiling; the quality a constant 23
(`veryfast`), capped at 3.5 Mb/s with the sound beside it, so the longest clip, ten
minutes, stays under 300 MB, Bluesky's file limit. A passage of a few seconds takes a
few seconds. The source's metadata stays behind: a post carries the picture and the
sound, not the GPS of the phone that filmed it.

**One clip per passage.** Cutting again a passage the case already holds a clip of
answers that file (`held`), so a second press never makes a second copy, and only one
ffmpeg runs at a time, however many cuts are asked for.

**The contact sheet** (`file_sheet`) is drawn in the browser from the proofs' saved
pictures (frontend `lib/proofSheet.js`) and filed here in Media, made from its video as
a clip is. The same picture filed twice is one file.
"""

from __future__ import annotations

import io
import json
import math
import os
import subprocess
import tempfile
import threading
import uuid
import warnings
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable

from PIL import Image

from .. import layout
from ..workspace import CaseError
from . import ffmpeg as ffmpeg_engine
from . import inspect as inspect_engine
from . import media as media_engine
from . import scenes as scene_engine

if TYPE_CHECKING:
    from ..workspace import Case

#: The longest clip: Bluesky's limit on a video, and well past what one place needs.
MAX_SECONDS = 600.0
#: The shortest: X refuses a video under half a second.
MIN_SECONDS = 0.5
#: How near two times are to be the same passage.
SAME = 1e-3
#: What the derivation is recorded as, under Inspect's own source type: a video cut
#: from a video of the case, as an enhanced one is (`inspect.enhance_video`).
SOURCE_TYPE = "inspect"
OP = "clip"
#: The encode, as the module says why.
LONG_SIDE = 1920
MAX_FPS = 60.0
PRESET = "veryfast"
CRF = "23"
MAXRATE = "3500k"
BUFSIZE = "7000k"
AUDIO_RATE = "128k"
#: Left to itself ffmpeg takes a thread and a half per core, each holding frames:
#: four keep it light on any machine (`mapplates.VIDEO_THREADS`).
THREADS = str(max(1, min(4, os.cpu_count() or 1)))
#: The picture down to `LONG_SIDE` on its long side, never up, with even sides.
SCALE = (
    f"scale=w='min(iw,{LONG_SIDE})':h='min(ih,{LONG_SIDE})':force_original_aspect_ratio=decrease,"
    "crop=trunc(iw/2)*2:trunc(ih/2)*2:0:0,setsar=1"
)
NO_FFMPEG = "cutting a clip needs ffmpeg; the release binaries bring it, a pip install needs it on PATH"
#: The contact sheet: a JPEG (or a PNG) of 1600 × 900 under 1 MB as the browser draws it,
#: with room either side, and its record beside a clip's.
SHEET_OP = "sheet"
SHEET_MAX_BYTES = 2_000_000
SHEET_MAX_SIDE = 3200
SHEET_FORMATS = {"JPEG": ".jpg", "PNG": ".png"}

#: One ffmpeg at a time, whichever proof asks.
_one_at_a_time = threading.Lock()


class BadClip(ValueError):
    """A cut that cannot be made as asked, said in one sentence."""


@dataclass(frozen=True)
class Cut:
    """A passage of a proof's ★ video, checked: what a job cuts."""

    proof: str
    video: str
    start: float
    end: float
    #: The clip's length as the file has it: the passage, short of the video's end.
    length: float
    fps: float | None


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    return float(value)


def _times(start: Any, end: Any) -> tuple[float, float]:
    first, last = _number(start), _number(end)
    if first is None or last is None or first < 0:
        raise BadClip("a clip is a passage: a start and an end in seconds, from 0")
    if last <= first:
        raise BadClip("a clip must end after it starts")
    if last - first > MAX_SECONDS + SAME:
        raise BadClip("a clip runs ten minutes at most")
    if last - first < MIN_SECONDS - SAME:
        raise BadClip("a clip runs half a second at least")
    return first, last


def _spec(case: Case, name: str) -> tuple[Path, dict[str, Any]]:
    path = case.resolve_inside(layout.proof_spec_rel(name))
    try:
        spec = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise scene_engine.UnknownProof("no such proof") from exc
    except (OSError, json.JSONDecodeError) as exc:
        raise CaseError("that proof could not be read") from exc
    if not isinstance(spec, dict) or spec.get("azimut_proof") != 1:
        raise scene_engine.UnknownProof("no such proof")
    return path, spec


def _same(clip: dict[str, Any] | None, start: float, end: float) -> bool:
    if not clip:
        return False
    return abs(clip["start"] - start) < SAME and abs(clip["end"] - end) < SAME


def _cut_from(item: dict[str, Any] | None, video: str, start: float, end: float) -> bool:
    """Whether a media item is the clip of that passage of that video."""
    source = (item or {}).get("source") or {}
    if source.get("type") != SOURCE_TYPE or source.get("op") != OP or source.get("from") != video:
        return False
    first, last = _number(source.get("start")), _number(source.get("end"))
    return first is not None and last is not None and abs(first - start) < SAME and abs(last - end) < SAME


def star_clip(case: Case, spec: dict[str, Any]) -> tuple[str | None, dict[str, Any] | None]:
    """The proof's ★ video and the clip its scene holds of it while the file is in the
    case (`scenes.clip_file`), or None for either."""
    video, _moments = scene_engine.star_video(case, spec)
    stated = scene_engine.stated_scene(spec)
    if video is None or not stated or stated["video"] != video:
        return video, None
    return video, scene_engine.clip_file(case, stated.get("clip"))


def read(case: Case, name: str) -> dict[str, Any]:
    """What the Scene tab shows of a proof's clip: its ★ video, and the clip, or null."""
    _path, spec = _spec(case, name)
    video, clip = star_clip(case, spec)
    return {"proof": name, "video": video, "clip": clip}


def held(case: Case, name: str, video: str, start: float, end: float) -> dict[str, Any] | None:
    """The clip the case already holds of this passage, recorded on the proof if it was
    not, or None. The scene's own clip first, then any clip of that passage in Media,
    cut for another proof of the same video or kept after another passage replaced it."""
    _path, spec = _spec(case, name)
    _video, own = star_clip(case, spec)
    if own and _same(own, start, end) and _cut_from(media_engine.read_item(case, own["path"]), video, start, end):
        return own
    for item in case.list_media_items():
        path = item.get("path")
        if isinstance(path, str) and item.get("kind") == "video" and _cut_from(item, video, start, end):
            clip = {"path": path, "start": start, "end": end}
            record(case, name, video, clip)
            return scene_engine.clip_file(case, clip)
    return None


def plan(case: Case, name: str, start: Any, end: Any) -> Cut:
    """Check a cut before a job runs it: a passage of the proof's ★ video, inside it,
    half a second to ten minutes long. A proof on pictures alone has nothing to cut."""
    first, last = _times(start, end)
    _path, spec = _spec(case, name)
    video, _moments = scene_engine.star_video(case, spec)
    if video is None:
        raise BadClip("this proof rests on no video in the case")
    if not ffmpeg_engine.ffmpeg_available():
        raise BadClip(NO_FFMPEG)
    try:
        probe = inspect_engine.probe(case, video)
    except (OSError, ValueError, CaseError, subprocess.SubprocessError) as exc:
        raise BadClip("the video's length could not be read") from exc
    duration = _number(probe.get("duration")) or 0.0
    if duration <= 0:
        raise BadClip("the video's length could not be read")
    if last > duration + scene_engine.END_SLACK:
        raise BadClip("that passage runs past the end of the video")
    length = min(last, duration) - first
    if length < MIN_SECONDS - SAME:
        raise BadClip("that passage is too short to cut")
    fps = _number(probe.get("fps"))
    return Cut(proof=name, video=video, start=first, end=last, length=length, fps=fps)


def _clock(time: float) -> str:
    """A time for a file name, which takes no colon: ``2m05s``, ``1h02m05s``."""
    total = max(0, math.floor(time))
    hours, rest = divmod(total, 3600)
    minutes, seconds = divmod(rest, 60)
    return f"{hours}h{minutes:02d}m{seconds:02d}s" if hours else f"{minutes}m{seconds:02d}s"


def clip_title(case: Case, cut: Cut) -> str:
    """The clip's name: the video's, as the case calls it, and the passage."""
    items = case.media_items_by_paths([cut.video])
    title = scene_engine.file_title(items[0] if items else None, cut.video)
    return f"{title} {_clock(cut.start)}–{_clock(cut.end)}"


def _command(src: Path, target: Path, cut: Cut) -> list[str]:
    graph = SCALE + (f",fps={MAX_FPS:g}" if cut.fps and cut.fps > MAX_FPS + 0.01 else "") + ",format=yuv420p"
    return [
        ffmpeg_engine.ffmpeg_exe(), "-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-threads", THREADS,
        # before the input, so the decode starts at the keyframe before and the output at the exact frame
        "-ss", f"{cut.start:.3f}", "-i", str(src), "-t", f"{cut.length:.3f}",
        "-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn", "-map_metadata", "-1", "-map_chapters", "-1",
        "-vf", graph,
        "-c:v", "libx264", "-preset", PRESET, "-crf", CRF, "-maxrate", MAXRATE, "-bufsize", BUFSIZE,
        "-profile:v", "high", "-threads", THREADS,
        "-c:a", "aac", "-b:a", AUDIO_RATE, "-ar", "48000", "-ac", "2",
        "-movflags", "+faststart", "-progress", "pipe:1", "-nostats", str(target),
    ]


def _timeout(length: float) -> float:
    """How long a cut may run before it is stopped: slow software encoding allowed."""
    return max(120.0, length * 8 + 60)


def _progress_at(line: str) -> float | None:
    """The seconds of output written, off one line of ffmpeg's ``-progress``."""
    key, _sep, value = line.strip().partition("=")
    if key not in ("out_time_us", "out_time_ms"):  # both are microseconds
        return None
    try:
        micro = int(value)
    except ValueError:
        return None
    return micro / 1_000_000 if micro >= 0 else None


def _encode(src: Path, target: Path, cut: Cut, set_progress: Callable[[dict[str, Any]], None]) -> None:
    with tempfile.TemporaryFile() as errors:
        proc = subprocess.Popen(_command(src, target, cut), stdout=subprocess.PIPE, stderr=errors)
        stopped = threading.Event()

        def stop() -> None:
            stopped.set()
            proc.kill()

        watchdog = threading.Timer(_timeout(cut.length), stop)
        watchdog.daemon = True
        watchdog.start()
        try:
            assert proc.stdout is not None
            for raw in proc.stdout:
                done = _progress_at(raw.decode("utf-8", "replace"))
                if done is not None and cut.length > 0:
                    set_progress({"percent": round(min(99.0, done * 100 / cut.length), 1)})
            proc.wait()
        finally:
            watchdog.cancel()
            if proc.poll() is None:
                proc.kill()
                proc.wait()
        if stopped.is_set():
            raise subprocess.TimeoutExpired(proc.args, _timeout(cut.length))
        errors.seek(0)
        stderr = errors.read()
    if proc.returncode != 0 or not target.is_file() or target.stat().st_size == 0:
        raise inspect_engine.ffmpeg_failed("cut", stderr)


def record(case: Case, name: str, video: str, clip: dict[str, Any]) -> None:
    """Write the clip on the proof's scene, and nothing else of it. The ★ may have moved
    while the clip was cut: the clip then stays in Media, and the scene as it is."""
    with case.lock:
        path, spec = _spec(case, name)
        star, _moments = scene_engine.star_video(case, spec)
        stated = scene_engine.stated_scene(spec)
        if star != video or (stated and stated["video"] != video):
            raise BadClip("the proof is about another video now; the clip is in Media")
        base = stated or {"video": video, "moments": [], "draft": None}
        spec["scene"] = {**base, "clip": clip}
        media_engine.write_json_atomic(path, spec)


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def run(case: Case, cut: Cut, set_progress: Callable[[dict[str, Any]], None]) -> dict[str, Any]:
    """Cut the passage, file it in Media and record it on the proof's scene. Answers the
    clip as the Scene tab shows it (`scenes.clip_file`)."""
    set_progress({"percent": 0})
    with _one_at_a_time:
        # asked for meanwhile, by a second press or another tab
        found = held(case, cut.proof, cut.video, cut.start, cut.end)
        if found:
            return {"clip": found}
        src = case.resolve_inside(cut.video)
        temporary = case.subdir("media") / f".clip-{uuid.uuid4().hex}.mp4"
        try:
            _encode(src, temporary, cut, set_progress)
            set_progress({"percent": 100, "stage": "filing"})
            entity = case.find_entity(attr="path", value=cut.video)
            source = {
                "type": SOURCE_TYPE, "op": OP, "from": cut.video,
                "from_sha256": (entity or {}).get("attrs", {}).get("sha256"),
                "start": cut.start, "end": cut.end, "proof": cut.proof, "at": _now(),
            }
            filed = media_engine.import_produced_file(case, temporary, f"{clip_title(case, cut)}.mp4", source, by="proof")
        finally:
            temporary.unlink(missing_ok=True)
    clip = {"path": filed["item"]["path"], "start": cut.start, "end": cut.end}
    record(case, cut.proof, cut.video, clip)
    return {"clip": scene_engine.clip_file(case, clip)}


def _sheet_picture(data: bytes) -> str:
    """The suffix a contact sheet is filed with, once its bytes read as one: a JPEG or a
    PNG of a sheet's size, refused past the pixel clamp before it is decoded."""
    if len(data) > SHEET_MAX_BYTES:
        raise BadClip("a contact sheet is under 2 MB")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as picture:
                kind, size = picture.format, picture.size
                picture.verify()
    except (Image.DecompressionBombWarning, Image.DecompressionBombError) as exc:
        raise BadClip("the contact sheet is too large a picture") from exc
    except Exception as exc:
        raise BadClip("the contact sheet is not a readable picture") from exc
    if kind not in SHEET_FORMATS or max(size) > SHEET_MAX_SIDE:
        raise BadClip("a contact sheet is a JPEG or a PNG of 1600 by 900")
    return SHEET_FORMATS[kind]


def file_sheet(case: Case, video: str, data: bytes) -> dict[str, Any]:
    """File a video thread's contact sheet in Media, named after the video and made from
    it. Answers its path, the one already in the case when the same picture was filed."""
    entity = case.find_entity(attr="path", value=video)
    items = case.media_items_by_paths([video]) if entity and entity.get("type") == "media" else []
    if not items or items[0].get("kind") != "video":
        raise BadClip("that file is not a video of the case")
    suffix = _sheet_picture(data)
    title = f"{scene_engine.file_title(items[0], video)} contact sheet"
    source = {
        "type": SOURCE_TYPE, "op": SHEET_OP, "from": video,
        "from_sha256": (entity or {}).get("attrs", {}).get("sha256"), "at": _now(),
    }
    temporary = case.subdir("media") / f".sheet-{uuid.uuid4().hex}{suffix}"
    try:
        temporary.write_bytes(data)
        filed = media_engine.import_produced_file(case, temporary, f"{title}{suffix}", source, by="post")
    finally:
        temporary.unlink(missing_ok=True)
    return {"path": filed["item"]["path"]}
