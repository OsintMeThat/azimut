"""Import enrichment: what a file says about itself, read locally at import time.

Two facts per image, both cheap and both offline:

- **EXIF** — the GPS point and the capture date the camera wrote. Read with
  Pillow, the same source Inspect's EXIF analysis uses; the difference is that
  this runs unprompted in the background instead of on a click.
- **dHash** — a 64-bit difference hash of the pixels. It fingerprints *what the
  image shows*, so a resized or requantised copy of a picture already in the
  case still lands within a few bits of the original.

Nothing here decides anything. Results are written to the media sidecar and
proposed to the graph with ``status="suggested"`` (ONTOLOGY §4): a camera's own
metadata is a claim, and a claim the analyst has not looked at is not a fact.
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any

import numpy as np
from PIL import Image

from . import workqueue

if TYPE_CHECKING:
    from ..workspace import Case as CaseType

#: Only these media kinds are enriched. Video metadata needs ffprobe and is a
#: separate piece of work; audio and generic files carry nothing to read.
ENRICHED_KINDS = frozenset({"image"})

#: EXIF IFD pointers (EXIF 2.3 §4.6.3).
_GPS_IFD = 0x8825
_EXIF_IFD = 0x8769
_DATETIME_ORIGINAL = 36867

#: dHash grid: an 8x9 grayscale reduction gives 8x8 = 64 comparison bits.
_HASH_SIDE = 8

#: Hamming distance at or below which two hashes are proposed as the same
#: picture. 10/64 tolerates rescaling and JPEG requantisation while keeping
#: unrelated photographs apart.
DHASH_MATCH = 10


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


def on_register(case: "CaseType", rel_media: str, kind: str, entity_id: str) -> None:
    """Queue enrichment for a freshly imported item. Keyed on the media path, so
    a re-import or a backfill never stacks duplicates."""
    if kind not in ENRICHED_KINDS:
        return
    workqueue.enqueue(
        case,
        ENRICH_KIND,
        key=rel_media,
        payload={"path": rel_media, "entity_id": entity_id},
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

    facts: dict[str, Any] = {"enriched_at": _now()}
    facts.update(exif_facts(path))
    try:
        facts["dhash"] = dhash(path)
    except Exception:  # unreadable pixels: the EXIF still stands on its own
        pass
    media_engine.merge_item(case, rel, facts)


workqueue.register(ENRICH_KIND, _handle)
