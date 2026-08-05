"""Import enrichment: what a file says about itself, read locally in a job.

- **Image EXIF** — every readable main, EXIF, GPS, interoperability, maker-note
  and thumbnail IFD field, with GPS and capture time parsed for suggestions.
- **Image dHash** — a 64-bit pixel fingerprint, so a resized or requantised copy
  of a picture already in the case still lands within a few bits of the original.
- **Video metadata** — ffprobe's container, stream and arbitrary tag fields,
  including parsed ISO 6709 GPS and creation time when the file carries them.

Nothing here decides anything. Results are written to the media sidecar and
proposed to the graph with ``status="suggested"`` (ONTOLOGY §4): a camera's own
metadata is a claim, and a claim the analyst has not looked at is not a fact.
"""

from __future__ import annotations

import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any

import numpy as np
from PIL import ExifTags, Image

from . import ffmpeg as ffmpeg_engine
from . import links as link_engine
from . import workqueue

if TYPE_CHECKING:
    from ..workspace import Case as CaseType

#: Image EXIF/dHash and video container metadata are local, bounded reads. Audio
#: and generic files carry no enrichment workflow yet.
ENRICHED_KINDS = frozenset({"image", "video"})

#: EXIF IFD pointers (EXIF 2.3 §4.6.3).
_GPS_IFD = 0x8825
_EXIF_IFD = 0x8769
_MAKER_NOTE_IFD = 0x927C
_INTEROP_IFD = 0xA005
_THUMBNAIL_IFD = -1
_DATETIME_ORIGINAL = 36867

# EXIF is attacker-controlled input. Keep every readable tag, but bound both
# the tag count and each rendered value before it reaches a sidecar and the UI.
EXIF_TAG_CAP = 256
EXIF_VALUE_CAP = 512
VIDEO_FIELD_CAP = 512

_ISO6709 = re.compile(r"^\s*([+-]\d{2}(?:\.\d+)?)([+-]\d{3}(?:\.\d+)?)")

#: dHash grid: an 8x9 grayscale reduction gives 8x8 = 64 comparison bits.
_HASH_SIDE = 8

#: Hamming distance at or below which two hashes are proposed as the same
#: picture. 10/64 tolerates rescaling and JPEG requantisation while keeping
#: unrelated photographs apart.
DHASH_MATCH = 10
ENRICH_VERSION = 2

#: How many of the case's existing hashes one job compares against, newest
#: first. The scan is a linear read of the media index, so it is bounded rather
#: than left to grow with the case; past this, a near-duplicate simply is not
#: proposed. Exact-byte duplicates never reach here — ``media._register``
#: dedupes on SHA-256 first.
DHASH_SCAN_CAP = 5000

#: Link types this module proposes, from the shared registry. Neither is a chain
#: type, so neither cascades a delete nor leaves a tombstone: a suggestion the
#: analyst never looked at must not decide what a delete destroys.
LOCATED_AT = link_engine.LOCATED_AT
SAME_IMAGE_AS = link_engine.SAME_IMAGE_AS


def _decimal(dms: Any, ref: Any) -> float | None:
    """One EXIF coordinate: (degrees, minutes, seconds) rationals plus a N/S/E/W
    reference, folded into a signed decimal degree."""
    try:
        degrees, minutes, seconds = (float(part) for part in tuple(dms)[:3])
    except (TypeError, ValueError, ZeroDivisionError):
        return None
    value = degrees + minutes / 60 + seconds / 3600
    if str(ref).strip().upper() in ("S", "W"):
        value = -value
    return value


def _gps(exif: Image.Exif) -> dict[str, float] | None:
    """The image's GPS point, or None when it has none, when the pair is
    incomplete, when it is out of range, or when it is exactly (0, 0) — Null
    Island is overwhelmingly a zeroed field rather than a photograph taken in the
    Gulf of Guinea."""
    try:
        gps = exif.get_ifd(_GPS_IFD)
    except Exception:
        return None
    if not gps:
        return None
    lat = _decimal(gps.get(2), gps.get(1))
    lon = _decimal(gps.get(4), gps.get(3))
    if lat is None or lon is None:
        return None
    if not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
        return None
    if lat == 0 and lon == 0:
        return None
    return {"lat": lat, "lon": lon}


def _taken_at(exif: Image.Exif) -> str | None:
    """DateTimeOriginal as an ISO string. No timezone is appended: EXIF records
    the camera's own clock with no offset, and stamping a ``Z`` on it would claim
    a UTC the file never asserted."""
    try:
        raw = exif.get_ifd(_EXIF_IFD).get(_DATETIME_ORIGINAL)
    except Exception:
        return None
    if not raw:
        return None
    try:
        parsed = datetime.strptime(str(raw).strip(), "%Y:%m:%d %H:%M:%S")
    except ValueError:
        return None
    return parsed.strftime("%Y-%m-%dT%H:%M:%S")


def _display_value(value: Any) -> str:
    """A bounded, JSON-safe rendering of one EXIF value.

    The cap is applied while building the string, not after: a maker note is a
    megabyte of bytes and a lens table is thousands of rationals, and rendering
    either one in full before slicing it to 512 characters would do all the work
    the cap exists to avoid.
    """
    if isinstance(value, bytes):
        decoded = value[: EXIF_VALUE_CAP + 1].rstrip(b"\x00").decode("utf-8", errors="replace")
        if not decoded.isprintable():  # a binary blob: report its size instead
            return f"{len(value)} bytes"
        return decoded[:EXIF_VALUE_CAP] + ("…" if len(value) > EXIF_VALUE_CAP else "")
    if isinstance(value, (tuple, list)):
        parts: list[str] = []
        length = 0
        for part in value:
            parts.append(str(part))
            length += len(parts[-1]) + 2
            if length > EXIF_VALUE_CAP:
                break
        text = ", ".join(parts)
    else:
        text = str(value)
    return text[:EXIF_VALUE_CAP] + ("…" if len(text) > EXIF_VALUE_CAP else "")


def exif_metadata(path: Path) -> dict[str, str]:
    """Every readable EXIF tag, flattened into display-ready key/value rows.

    Pillow keeps GPS and camera tags in nested IFDs. Expand those rather than
    exposing their numeric pointers, and prefix duplicate names only when one
    would otherwise overwrite another. The bounded strings can be stored in a
    media sidecar and rendered without re-opening the image.
    """
    try:
        with Image.open(path) as img:
            exif = img.getexif()
            if not exif:
                return {}

            rows: dict[str, str] = {}

            def add(name: str, value: Any, prefix: str = "") -> None:
                if len(rows) >= EXIF_TAG_CAP:
                    return
                key = name if name not in rows else f"{prefix}{name}"
                if key in rows:
                    return
                rows[key] = _display_value(value)

            for tag_id, value in exif.items():
                if tag_id in (_GPS_IFD, _EXIF_IFD):
                    continue
                add(ExifTags.TAGS.get(tag_id, str(tag_id)), value, "Image ")

            def read_ifd(ifd: int) -> dict[int, Any]:
                try:
                    return exif.get_ifd(ifd)
                except Exception:
                    return {}

            interop_names = {
                int(member): member.name
                for member in getattr(ExifTags, "Interop", ())
            }
            ifd_specs: tuple[tuple[int, dict[int, str], str], ...] = (
                (_EXIF_IFD, ExifTags.TAGS, "EXIF "),
                (_GPS_IFD, ExifTags.GPSTAGS, "GPS "),
                (_INTEROP_IFD, interop_names, "Interop "),
                (_MAKER_NOTE_IFD, {}, "Maker note "),
                (_THUMBNAIL_IFD, ExifTags.TAGS, "Thumbnail "),
            )

            for ifd, names, prefix in ifd_specs:
                for tag_id, value in read_ifd(ifd).items():
                    add(names.get(tag_id, str(tag_id)), value, prefix)

            return rows
    except Exception:
        return {}


def exif_facts(path: Path) -> dict[str, Any]:
    """The GPS point and capture date an image carries. Missing, unreadable or
    implausible values are left out rather than reported as empty: this feeds
    suggestions, and a suggestion of nothing is noise."""
    try:
        with Image.open(path) as img:
            exif = img.getexif()
    except Exception:  # unreadable file, decode clamp, no EXIF block at all
        return {}
    facts: dict[str, Any] = {}
    gps = _gps(exif)
    if gps:
        facts["gps"] = gps
    taken = _taken_at(exif)
    if taken:
        facts["taken_at"] = taken
    return facts


def _flatten_video(prefix: str, value: Any, rows: dict[str, str]) -> None:
    """Flatten ffprobe JSON without assuming today's container tag vocabulary."""
    if len(rows) >= VIDEO_FIELD_CAP:
        return
    if isinstance(value, dict):
        for key, nested in value.items():
            clean_key = str(key).replace("_", " ")[:120]
            label = f"{prefix} · {clean_key}" if prefix else clean_key
            _flatten_video(label, nested, rows)
        return
    if isinstance(value, list):
        for index, nested in enumerate(value):
            _flatten_video(f"{prefix} {index}", nested, rows)
        return
    rows[prefix] = _display_value(value)


def _video_gps(data: dict[str, Any]) -> dict[str, float] | None:
    """A QuickTime/MP4 ISO 6709 location tag, or a decimal GPS pair."""
    tags: list[tuple[str, Any]] = []
    format_data = data.get("format")
    if isinstance(format_data, dict) and isinstance(format_data.get("tags"), dict):
        tags.extend(format_data["tags"].items())
    for stream in data.get("streams", []):
        if isinstance(stream, dict) and isinstance(stream.get("tags"), dict):
            tags.extend(stream["tags"].items())

    for key, raw in tags:
        folded = str(key).casefold()
        if "location" not in folded and "gps" not in folded:
            continue
        text = str(raw).strip()
        match = _ISO6709.match(text)
        if match:
            lat, lon = float(match.group(1)), float(match.group(2))
            if -90 <= lat <= 90 and -180 <= lon <= 180 and (lat != 0 or lon != 0):
                return {"lat": lat, "lon": lon}
        parts = [part.strip() for part in text.split(",", 1)]
        if len(parts) == 2:
            try:
                lat, lon = float(parts[0]), float(parts[1])
            except ValueError:
                continue
            if -90 <= lat <= 90 and -180 <= lon <= 180 and (lat != 0 or lon != 0):
                return {"lat": lat, "lon": lon}
    return None


def video_facts(path: Path) -> dict[str, Any] | None:
    """All ffprobe container/stream metadata, plus parsed GPS and capture time.

    ``None`` means the probe never ran — ffprobe is missing, or it died or timed
    out — so no enrichment version is stamped and the backfill will try this file
    again. An unreadable video returns an empty dict instead: ffprobe did look and
    the file exposed no trustworthy metadata, which is an answer, and re-reading it
    on every backfill would never produce a different one.
    """
    probe = ffmpeg_engine.ffprobe_path()
    if probe is None:
        return None
    try:
        proc = subprocess.run(
            [
                probe,
                "-v",
                "error",
                "-print_format",
                "json",
                "-show_format",
                "-show_streams",
                str(path),
            ],
            capture_output=True,
            timeout=30,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None  # the probe never finished: transient, so let it be retried
    if proc.returncode != 0:
        return {}
    try:
        data = json.loads(proc.stdout or b"{}")
    except (TypeError, ValueError):
        return {}
    if not isinstance(data, dict):
        return {}

    rows: dict[str, str] = {}
    _flatten_video("", data, rows)
    facts: dict[str, Any] = {"video_metadata": rows} if rows else {}
    gps = _video_gps(data)
    if gps:
        facts["gps"] = gps

    format_data = data.get("format")
    tags = format_data.get("tags") if isinstance(format_data, dict) else {}
    taken_at = tags.get("creation_time") if isinstance(tags, dict) else None
    if not taken_at:
        for stream in data.get("streams", []):
            stream_tags = stream.get("tags") if isinstance(stream, dict) else None
            if isinstance(stream_tags, dict) and stream_tags.get("creation_time"):
                taken_at = stream_tags["creation_time"]
                break
    if taken_at:
        facts["taken_at"] = str(taken_at)
    return facts


def dhash(path: Path) -> str:
    """A 64-bit difference hash of the image, as 16 hex characters.

    The picture is reduced to a 9x8 grayscale grid and each pixel is compared
    with its right-hand neighbour: what survives is the gradient structure, which
    is what stays the same across a resize or a re-encode.
    """
    with Image.open(path) as img:
        gray = img.convert("L").resize((_HASH_SIDE + 1, _HASH_SIDE), Image.Resampling.BILINEAR)
    pixels = np.asarray(gray, dtype=np.int16)
    brighter = pixels[:, 1:] > pixels[:, :-1]
    return str(np.packbits(brighter.flatten()).tobytes().hex())


def hamming(a: str, b: str) -> int:
    """Bit distance between two dHashes. A mismatched length means one of them
    came from a different generator, so nothing is comparable: report the maximum."""
    if len(a) != len(b):
        return _HASH_SIDE * _HASH_SIDE
    return bin(int(a, 16) ^ int(b, 16)).count("1")


# -- the enrich job ---------------------------------------------------------

#: Job kind for the durable queue. Enrichment is queued, never inline: an import
#: must stay as fast as the copy it performs.
ENRICH_KIND = "enrich"


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def on_register(case: "CaseType", rel_media: str, kind: str, entity_id: str) -> bool:
    """Queue enrichment for a freshly imported item. Keyed on the media path, so
    a re-import or a backfill never stacks duplicates.

    Returns whether a job was queued, so a caller counting work (the Enrich
    button's backfill) reports what the queue took rather than what it offered.
    """
    if kind not in ENRICHED_KINDS:
        return False
    workqueue.enqueue(
        case,
        ENRICH_KIND,
        key=rel_media,
        payload={"path": rel_media, "entity_id": entity_id},
    )
    return True


def _suggest_place(case: "CaseType", entity_id: str, gps: dict[str, float]) -> None:
    """Propose the media's own coordinates as a place, and point the media at it.

    Places are deduplicated on a rounded coordinate key (about 1 m), so a roll
    of photographs from one spot proposes one place rather than forty. The key
    is an attribute of the places enrichment mints; a place the analyst pinned
    by hand has none and is left alone, because merging the two is a judgement
    the Suggestions panel exists to let them make.

    A relation already stated for this media wins over a later backfill. This is
    especially important after importing a case from an older Azimut release:
    its media may need the current enrichment pass, but its confirmed
    ``Relate to`` choices are investigation state and must not return as a new
    GPS suggestion.
    """
    from . import satellite as satellite_engine

    if any(link["type"] == LOCATED_AT for link in case.links_of(entity_id)):
        return

    key = f"{gps['lat']:.5f},{gps['lon']:.5f}"
    place = case.find_entity(attr="enrich_coord_key", value=key)
    if place is None:
        place = satellite_engine.save_place(
            case,
            gps["lat"],
            gps["lon"],
            by="enrich",
            extra_attrs={"enrich_coord_key": key},
            status="suggested",
        )
    case.add_link(
        entity_id,
        place["id"],
        LOCATED_AT,
        by="enrich",
        status="suggested",
        unique=True,
    )


def _suggest_same_image(case: "CaseType", entity_id: str, rel: str, digest: str) -> None:
    """Propose the case's other pictures of the same scene.

    Bounded on purpose (``DHASH_SCAN_CAP``): this runs inside a job on every
    import, and an unbounded scan would grow with the case until an import of
    one photo reads the whole media index.

    Each match's entity comes off the index row it was already read from. A
    per-match graph lookup would be a full scan of the entities table, and a
    burst of near-identical photographs is exactly the case that produces many
    matches at once.
    """
    for item in case.list_media_items()[:DHASH_SCAN_CAP]:
        other = item.get("dhash")
        path = item.get("path")
        if not other or path == rel:
            continue
        if hamming(digest, other) > DHASH_MATCH:
            continue
        match_id = item.get("entity_id")
        if not match_id:
            continue
        # Symmetric in meaning, canonical in storage. Sorting prevents a later
        # enrichment pass from filing the same match in the reverse direction.
        from_id, to_id = sorted((entity_id, match_id))
        case.add_link(
            from_id,
            to_id,
            SAME_IMAGE_AS,
            by="enrich",
            status="suggested",
            unique=True,
        )


def _handle(case: "CaseType", job: dict[str, Any]) -> None:
    """Run one enrichment job: read the file's own claims, record them on the
    sidecar. A media file that is gone cancels the job."""
    from . import media as media_engine

    rel = job["payload"].get("path")
    item = media_engine.read_item(case, rel) if rel else None
    if item is None:
        raise workqueue.JobCancelled(f"media gone: {rel}")
    path = case.resolve_inside(rel)
    if not path.exists():
        raise workqueue.JobCancelled(f"media gone: {rel}")

    # Has this file been through a completed enrichment before? Re-reading it
    # refreshes the facts, but it must not re-propose edges: dropping a suggestion
    # is how an analyst says "not that", and an Enrich click that resurrected every
    # dismissal would make the gesture unusable. Media from an older release has no
    # version stamp, so a first backfill still gets its suggestions.
    first_pass = item.get("enrich_version") is None

    facts: dict[str, Any] = {"enriched_at": _now()}
    if item.get("kind") == "video":
        video = video_facts(path)
        if video is None:
            facts["video_probe"] = "unavailable"
        else:
            facts["enrich_version"] = ENRICH_VERSION
            facts.update(video)
    else:
        facts["enrich_version"] = ENRICH_VERSION
        facts.update(exif_facts(path))
        metadata = exif_metadata(path)
        if metadata:
            facts["exif"] = metadata
        try:
            facts["dhash"] = dhash(path)
        except Exception:  # unreadable pixels: the EXIF still stands on its own
            pass
    media_engine.merge_item(case, rel, facts)

    # The facts are recorded either way; the graph only hears about them as
    # proposals (ONTOLOGY §4). A missing entity id means this media predates the
    # link — the sidecar still gains its facts.
    if not first_pass:
        return
    entity_id = job["payload"].get("entity_id") or (
        case.find_entity(attr="path", value=rel) or {}
    ).get("id")
    if not entity_id:
        return
    if facts.get("gps"):
        _suggest_place(case, entity_id, facts["gps"])
    if facts.get("dhash"):
        _suggest_same_image(case, entity_id, rel, facts["dhash"])


workqueue.register(ENRICH_KIND, _handle)
