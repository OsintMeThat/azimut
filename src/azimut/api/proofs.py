"""REST API for proofs: save (PNG + re-editable JSON spec), list, load, delete.

The spec is the source of truth — a proof saved once reopens for re-editing
(spec §6 v1). The PNG is the publishable export of that spec, and its cached
thumbnail is what the open dialog shows.

A proof may also hold pasted images: pixels that belong to the composition
alone, with no source in the case. They live in a ``<name>.assets`` folder
beside the spec, named by their own hash, and they are never filed as media or
as an entity — nothing in the graph claims a paste came from anywhere.

A proof imported as published keeps its picture in the same folder, named the
same way, under the spec's ``published`` list: the picture is the proof as it
was published, with no background, margins or footer around it.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import re
import struct
import zlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from PIL import Image
from pydantic import BaseModel, Field, StrictBool

from .. import config
from ..engine import artifacts as artifact_engine
from ..engine import copernicus_credit
from ..engine import exportdir, geolocate, inspectwork, layerediting
from ..engine import links as link_engine
from ..engine import localtime
from ..engine import media as media_engine
from ..engine import proofimport as import_engine
from ..engine import renames as rename_engine
from ..engine import reveal as reveal_engine
from ..engine import satellite as satellite_engine
from ..engine import scenes as scene_engine
from ..engine import temporal
from ..engine import thumbnails as thumbnail_engine
from ..workspace import Case, CaseError, ensure_dir
from . import events
from .cases import delete_by_path, get_case
from .cases.common import delete_entity_deep
from .inspect import say_geolocating
from .naming import holders, read_created_at, slugify, technical_name
from .satellite import locate_on_save
from .. import layout

router = APIRouter(prefix="/api", tags=["proofs"])


ASSET_NAME = re.compile(r"^[0-9a-f]{16}\.(?:png|jpe?g|webp)$")
MAX_ASSET_BYTES = 20 * 1024 * 1024
MAX_ASSETS = 12

#: Room for the rendered export. One picture, so it is bounded like the others the
#: browser hands back (`api/limits.MAX_IMAGE_BYTES`), with the slack a multi-panel
#: composition needs over a single screenshot.
MAX_EXPORT_BYTES = 48 * 1024 * 1024

#: What `POST /cases/{id}/proofs` may weigh, refused by `server.BulkBodyLimit` before
#: Pydantic materialises it. Computed rather than picked, from the two limits the route
#: already declares: the export plus every pasted image a save may carry, at base64's
#: four-thirds, plus room for the spec. Guessing a round number here would either refuse a
#: save the composer considers legal or leave the declared maxima unreachable.
#:
#: The ceiling is deliberately high, because those maxima are: twelve pastes at 20 MiB is a
#: real first save. What this stops is the *unbounded* case — the export field carried no
#: limit at all, and every refusal in `_decode_assets` arrived after the whole body had
#: been parsed into memory.
MAX_PROOF_BODY_BYTES = (
    (MAX_EXPORT_BYTES + MAX_ASSETS * MAX_ASSET_BYTES) * 4
) // 3 + 2 * 1024 * 1024


class AssetIn(BaseModel):
    """A pasted image the composer is holding but has never written.

    ``name`` is the first 16 hex digits of the payload's own sha256 plus its
    extension. The server checks that, so the same paste never lands twice and a
    save cannot address a file it did not bring.
    """

    name: str = Field(min_length=1, max_length=40)
    data: str  # base64 body


class ProofIn(BaseModel):
    # The filename always follows the title, so renaming a saved proof moves its
    # spec and its export. ``rename_from`` is the stem the composer is currently
    # bound to (absent on a first save); a save that lands elsewhere renames
    # those files in place instead of leaving a copy under the old name. An empty
    # title is no name: the proof files under a technical one, "Proof 3"
    # (`technical_name`), which is how a name is cleared.
    rename_from: str | None = None
    title: str = Field(default="", max_length=200)
    spec: dict[str, Any]
    # The rendered export, as the data URL's body. Bounded twice: the whole request by
    # `server.BulkBodyLimit`, and the decoded picture by `MAX_EXPORT_BYTES` below.
    png_base64: str | None = None
    # Pasted images the spec references but the case does not hold yet. They ride
    # along with the save rather than through an upload of their own, so a proof
    # the analyst never saves leaves nothing behind.
    assets: list[AssetIn] = Field(default_factory=list)


class SceneIn(BaseModel):
    """When in its video a proof happens: its moments, each ``{start, end}`` with
    ``end`` null for an instant. Read by `scenes._stated_moments`, which refuses what
    is not a time rather than letting Pydantic turn ``true`` into 1.

    ``video`` moves the ★ to another video a panel was cut from, and ``draft`` names
    the Inspect scene the proof takes up. Left out, each stays as it is. No moments is
    the whole video, kept as stated; ``traced`` takes the proof back to its frames
    instead, the Undo of its first time."""

    moments: Any
    video: Any = None
    draft: Any = None
    traced: StrictBool = False


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _stored_scene(path: Path) -> Any:
    """The ``scene`` a proof's spec on disk holds, or None."""
    try:
        data: Any = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return data.get("scene") if isinstance(data, dict) else None


def _write_spec(path: Path, spec: dict[str, Any]) -> None:
    media_engine.write_json_atomic(path, spec)


#: What a proof says about itself in words and in time, beside the composition.
#: Both are optional — a proof with neither is the proof this app shipped with —
#: and both are mirrored onto the entity, so the graph, the Timeline and search
#: read them without opening one JSON file per proof.
_STATED_TEXT_MAX = 2000


def _chosen_zone(spec: dict[str, Any]) -> str | None:
    """The zone the analyst picked for the proof's date, or None for *at the point*."""
    raw = spec.get("whenZone")
    if raw in (None, ""):
        return None
    if not temporal.valid_zone(raw):
        raise HTTPException(status_code=422, detail="unknown time zone")
    return str(raw)


def _point_zone(spec: dict[str, Any]) -> str | None:
    """The zone of the proof's first point, the one every single-answer surface reads.

    A date read off footage is read on the clock of the place it shows, so that is
    where the day begins. No point, no zone: the date then spans UTC's day, as a
    date stated before zones existed always has.
    """
    points = satellite_engine.spec_points(spec)
    if not points:
        return None
    return localtime.zone_for(float(points[0]["lat"]), float(points[0]["lon"]))


def _stated_zone(spec: dict[str, Any]) -> str | None:
    """The zone the proof's date is read in: the analyst's pick, else its point's."""
    return _chosen_zone(spec) or _point_zone(spec)


def _stated_when(spec: dict[str, Any], zone: str | None = None) -> str:
    """The date the proof states, checked against the profile the case stores.

    Refused here rather than stored and puzzled over later: a value the temporal
    parser cannot read would reach the Timeline as a parse error on a row nobody
    asked for, and the composer has the same profile in front of the analyst.
    """
    raw = spec.get("when")
    if raw in (None, ""):
        return ""
    if not isinstance(raw, str):
        raise HTTPException(status_code=422, detail="a date must be text")
    value = raw.strip()
    if not value:
        return ""
    try:
        temporal.parse_temporal(value, tz=zone)
    except temporal.TemporalError as exc:
        raise HTTPException(status_code=422, detail=f"unsupported date: {exc}") from exc
    return value


def _stated_description(spec: dict[str, Any]) -> str:
    """The sentence the proof carries, which is the entity's own notes."""
    raw = spec.get("description")
    return raw.strip()[:_STATED_TEXT_MAX] if isinstance(raw, str) else ""


#: The longest credit kept on a proof: a hundred panels' providers, said once each.
_CREDITS_MAX = 2000


def imagery_credits(spec: dict[str, Any]) -> str:
    """The credits a proof's pictures ask for, each said once, joined with `` · ``.

    Mirrors ``imageryCredits`` in ``lib/composer.js``: each panel's credit as its
    capture or picture kept it, read in today's words for the day it shows. The
    footer prints them only when asked (``footerCredits``); the proof keeps them
    either way, on its record and in its PNG.
    """
    parts: list[str] = []
    for panel in spec.get("panels") or []:
        meta = panel.get("meta") if isinstance(panel, dict) else None
        if not isinstance(meta, dict):
            continue
        day = meta.get("imagery_date")
        credit = copernicus_credit.normalise_attribution(
            meta.get("attribution") or "", day if isinstance(day, str) else None
        )
        for part in re.split(r"\s+·\s+", credit):
            text = part.strip()
            if text and text not in parts:
                parts.append(text)
    return " · ".join(parts)[:_CREDITS_MAX]


#: The PNG text keyword the credits are written under. ``Copyright`` is one of the
#: keywords the PNG specification predefines (a "Copyright notice"), so image
#: viewers and exiftool show it by name; ``Credit`` is an IPTC field PNG does not
#: define, and few readers would surface it.
PNG_CREDIT_KEY = b"Copyright"
_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def with_credits(png: bytes, credits: str) -> bytes:
    """The PNG with ``credits`` in a UTF-8 text chunk, right after its header.

    The pixels are not decoded again: one ``iTXt`` chunk is spliced in after
    ``IHDR``, which every reader accepts there. Anything that is not a PNG, or no
    credits, comes back as it was.
    """
    if not credits or not png.startswith(_PNG_SIGNATURE) or png[12:16] != b"IHDR":
        return png
    header_end = 8 + 4 + 4 + struct.unpack(">I", png[8:12])[0] + 4
    # keyword, then no compression, no language and no translated keyword
    body = PNG_CREDIT_KEY + b"\x00\x00\x00\x00\x00" + credits.encode("utf-8")
    chunk = struct.pack(">I", len(body)) + b"iTXt" + body + struct.pack(">I", zlib.crc32(b"iTXt" + body))
    return png[:header_end] + chunk + png[header_end:]


def _proof_thumb(case: Case, name: str, data: bytes | None = None) -> str | None:
    """Cached thumbnail for a proof's export, or None if it can't be produced.

    The export is a full-resolution PNG, far too heavy for the open dialog's
    rows. It goes through the media thumbnail cache: content-addressed, so two
    identical exports share one file and a re-export lands on a new immutable
    URL, and disposable, so eviction just means the next listing regenerates it.
    ``data`` skips re-reading bytes we already hold (the save path).
    """
    png_rel = layout.proof_export_rel(name)
    path = case.resolve_inside(png_rel)
    if not path.is_file():
        return None
    digest = (
        hashlib.sha256(data).hexdigest() if data is not None else media_engine.sha256_file(path)
    )
    try:
        return thumbnail_engine.generate(case, png_rel, digest, "image")
    except thumbnail_engine.ThumbnailError:
        return None  # the dialog falls back to the export itself


def _decode_assets(assets: list[AssetIn]) -> dict[str, bytes]:
    """Decode and check the whole batch before a single file is written."""
    if len(assets) > MAX_ASSETS:
        raise HTTPException(
            status_code=422, detail=f"a proof holds at most {MAX_ASSETS} pasted images"
        )
    decoded: dict[str, bytes] = {}
    for asset in assets:
        if not ASSET_NAME.match(asset.name):
            raise HTTPException(status_code=422, detail="invalid asset name")
        try:
            data = base64.b64decode(asset.data, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise HTTPException(status_code=422, detail="invalid asset payload") from exc
        if not data or len(data) > MAX_ASSET_BYTES:
            raise HTTPException(status_code=422, detail="pasted image too large")
        if hashlib.sha256(data).hexdigest()[:16] != asset.name.split(".")[0]:
            raise HTTPException(status_code=422, detail="asset name does not match its content")
        decoded[asset.name] = data
    return decoded


def _referenced_assets(spec: dict[str, Any]) -> set[str]:
    """Asset filenames the spec still shows: its overlays and its published pictures."""
    held: set[str] = set()
    for key in ("pastes", "published"):
        items = spec.get(key)
        if isinstance(items, list):
            held |= {
                p["asset"] for p in items if isinstance(p, dict) and isinstance(p.get("asset"), str)
            }
    return held


def _published(spec: dict[str, Any]) -> list[dict[str, Any]] | None:
    """The spec's published pictures, checked at the door, or None for a proof that is not one.

    Each names a file in the proof's own assets folder, so its name is held to the shape
    a pasted overlay's is: the folder is read by it, and a name is never a path. Its size
    is what the composer lays the page out from, held to the bounds it can export.
    """
    raw = spec.get("published")
    if raw is None:
        return None
    if not isinstance(raw, list) or not 0 < len(raw) <= import_engine.MAX_PANELS:
        raise HTTPException(status_code=422, detail="invalid published pictures")
    entries: list[dict[str, Any]] = []
    for one in raw:
        natural = one.get("natural") if isinstance(one, dict) else None
        if (
            not isinstance(one, dict)
            or not isinstance(one.get("id"), str)
            or not 0 < len(one["id"]) <= 40
            or not isinstance(one.get("asset"), str)
            or not ASSET_NAME.match(one["asset"])
            or not isinstance(natural, list)
            or len(natural) != 2
            or not all(
                isinstance(n, int) and 0 < n <= import_engine.MAX_PAGE_SIDE for n in natural
            )
        ):
            raise HTTPException(status_code=422, detail="invalid published picture")
        url = one.get("url")
        entries.append(
            {
                "id": one["id"],
                "asset": one["asset"],
                "natural": [natural[0], natural[1]],
                **(
                    {"url": url[:4000]}
                    if isinstance(url, str) and media_engine.is_address(url)
                    else {}
                ),
            }
        )
    return entries


def published_export(
    spec: dict[str, Any], incoming: dict[str, bytes], folder: Path
) -> bytes | None:
    """The export of a published proof nobody drew on, made from its own pictures.

    Such a proof is the published picture and nothing else, so its export is that
    picture, byte for byte where it can be (`proofimport.published_png`), rather than
    the browser's redraw of it. A mark or an overlay makes it the composer's to draw,
    and None hands the save back the picture the browser sent.
    """
    published = spec.get("published")
    if not published or spec.get("shapes") or spec.get("pastes"):
        return None
    pictures: list[bytes] = []
    for entry in published:
        data = incoming.get(entry["asset"])
        if data is None:
            path = folder / entry["asset"]
            if not path.is_file():
                return None
            data = path.read_bytes()
        pictures.append(data)
    try:
        return import_engine.published_png(pictures)
    except (OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        return None


def _write_assets(folder: Path, incoming: dict[str, bytes], keep: set[str]) -> None:
    """Land the pasted images this save brings, then drop the ones it dropped.

    Names are content hashes, so writing is idempotent and pruning by "not in the
    spec" can never take a file the proof still shows. A proof left with no
    pasted images keeps no folder either.
    """
    if incoming:
        ensure_dir(folder)
        for asset_name, data in incoming.items():
            path = folder / asset_name
            if not path.exists():
                path.write_bytes(data)
    if not folder.is_dir():
        return
    for path in folder.iterdir():
        if path.is_file() and path.name not in keep:
            path.unlink(missing_ok=True)
    if not any(folder.iterdir()):
        folder.rmdir()


@router.get("/cases/{case_id}/proofs")
def list_proofs(case_id: str) -> list[dict[str, Any]]:
    """Every saved proof, newest first. A proof resting on a video says which and where
    it stands among its slides (`scenes.proof_slides`): ``video``, ``order`` (its colour
    on Inspect's bar) and ``slide`` of ``slides``. On photos, ``video`` is null."""
    case = get_case(case_id)
    proofs = []
    specs: list[tuple[str, dict[str, Any]]] = []
    # each proof's entity and each point's place, read once for the whole list
    lookup = scene_engine.Lookup(case)
    for spec_path in sorted(case.subdir("proofs").joinpath(layout.META_DIR).glob("*.json")):
        try:
            spec = json.loads(spec_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if spec.get("azimut_proof") != 1:
            continue
        name = spec_path.stem
        specs.append((name, spec))
        png = case.resolve_inside(layout.proof_export_rel(name))
        # Proofs saved before thumbnails existed (or whose cached file was
        # evicted) produce one here and record it, so this costs a hash of the
        # export once per proof rather than a full-size download per open.
        thumb = spec.get("thumb")
        if png.exists() and not (thumb and case.resolve_inside(thumb).exists()):
            thumb = _proof_thumb(case, name)
            spec["thumb"] = thumb
            try:
                _write_spec(spec_path, spec)
            except OSError:
                pass  # a read-only case still lists; it just re-renders next time
        points = satellite_engine.spec_points(spec)
        attrs = (lookup.proof(layout.proof_spec_rel(name)) or {}).get("attrs") or {}
        # the date Details holds wins over the spec's, blank included (`load_proof`)
        when = attrs["when"] if "when" in attrs else spec.get("when")
        proofs.append(
            {
                "name": name,
                "title": spec.get("title", name),
                "updated_at": spec.get("updated_at"),
                "created_at": spec.get("created_at"),
                "panels": len(spec.get("panels", [])),
                "shapes": len(spec.get("shapes", [])),
                # the points the proof states for itself, read before its
                # derivation so it keeps them when the capture is deleted
                "points": points,
                # What a proof with no name of its own is labelled by (frontend
                # `proofList.proofLabel`): its date, and where its conclusion stands
                # as the case knows it.
                "when": when if isinstance(when, str) and when.strip() else None,
                "place": satellite_engine.place_words(lookup.place(points[0]["lat"], points[0]["lon"])) if points else "",
                "png": layout.proof_export_rel(png.stem) if png.exists() else None,
                "thumb": thumb,
                "spec_path": layout.proof_spec_rel(spec_path.stem),
            }
        )
    slides = scene_engine.proof_slides(case, specs)
    for row in proofs:
        row.update(slides.get(row["name"]) or {"video": None})
    proofs.sort(key=lambda p: p.get("updated_at") or "", reverse=True)
    return proofs


@router.get("/cases/{case_id}/proofs/{name}")
def load_proof(case_id: str, name: str) -> dict[str, Any]:
    """The saved spec, opened on every point the proof concludes on.

    A sheet row can file a point for a proof it did not compose, so the graph holds
    points the spec never learned (``satellite.proof_points``). Opening on the spec
    alone showed one row for a proof the map drew twice, and the next save would
    have written that missing point out of the composition for good. The list comes
    back complete instead, and saving is what makes the spec agree with the map.

    The date and the description are completed the same way, and for the same
    reason: both are editable from the Details panel — one as an attribute, one as
    the entity's notes — so opening on the spec alone would show the composer a
    sentence the case had already replaced, and the next save would write the
    edit back out.
    """
    case = get_case(case_id)
    try:
        spec_path = case.resolve_inside(layout.proof_spec_rel(name))
    except CaseError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if not spec_path.exists():
        raise HTTPException(status_code=404, detail="proof not found")
    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    proof = case.find_entity(attr="spec", value=layout.proof_spec_rel(spec_path.stem))
    if isinstance(spec, dict) and proof is not None:
        opened = satellite_engine.open_spec(case, proof["id"], spec)
        attrs = proof.get("attrs") or {}
        # Present at all, it wins, blank included: clearing a date in Details is
        # the analyst taking it back, and the spec still holding it is stale.
        for key, attr in (("when", "when"), ("description", "notes")):
            if attr in attrs:
                stated = attrs[attr]
                opened[key] = (stated.strip() or None) if isinstance(stated, str) else None
        # The zone too, but only where it says something the spec does not: the
        # composer leaves it at *the point's* by default, and a zone the case holds
        # that the point would give anyway is that default, not a pick. One set in
        # Details that differs from it is the analyst's, and opens as their choice.
        held = attrs.get("when_zone")
        implied = _chosen_zone(opened) or _point_zone(opened)
        if isinstance(held, str) and held and held != implied and temporal.valid_zone(held):
            opened["whenZone"] = held
        # What the date is read in, whichever way it was chosen, for the reader that
        # only shows it (a post naming the offset).
        opened["whenZoneStated"] = (held if isinstance(held, str) and held else None) or (
            implied if opened.get("when") else None
        )
        return opened
    return spec


@router.post("/cases/{case_id}/proofs/{name}/export")
def export_proof_png(case_id: str, name: str) -> dict[str, str]:
    """Copy a saved proof's PNG into the proofs export folder.

    The proof itself does not move: this is the publishable picture, handed to
    wherever the analyst files finished work.
    """
    case = get_case(case_id)
    try:
        png = case.resolve_inside(layout.proof_export_rel(name))
    except CaseError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if not png.exists():
        raise HTTPException(status_code=404, detail="this proof has no export yet")
    try:
        folder = exportdir.destination("proofs", case.path)
        written = exportdir.copy_out(png, folder, png.name)
    except exportdir.ExportDirError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"file": written.name, "folder": str(folder), "path": str(written)}


class SeriesExportIn(BaseModel):
    """A video's slides to copy out as one numbered set. ``folder`` names the set's
    folder inside the proofs export folder, the video's own name when left out."""

    video: str = Field(min_length=1, max_length=1024)
    folder: str | None = Field(default=None, max_length=200)


@router.post("/cases/{case_id}/proofs/series-export")
def export_proof_series(case_id: str, body: SeriesExportIn) -> dict[str, Any]:
    """Copy the saved picture of every proof about one video into a folder of its own,
    numbered in clip order: `<video>/01 Road bridge.png`, `02 …`.

    Nothing is rendered again, since each slide is saved as it is left. The scenes
    still to prove have no picture, so they are not slides here; a proof never
    exported is left out and named in the answer. The numbers count what is written,
    so the set has no gap. The folder is a new one each time, numbered past a set
    already there, inside the destination saved for proofs: the browser names a
    folder, never a path.
    """
    case = get_case(case_id)
    try:
        rows = scene_engine.slides(case, body.video)
    except scene_engine.BadScene as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    pictured = [row for row in rows if row["png"]]
    skipped = [{"proof": row["proof"], "title": row["title"]} for row in rows if not row["png"]]
    if not pictured:
        raise HTTPException(status_code=422, detail="no slide of this video has a picture yet")
    width = max(2, len(str(len(pictured))))
    files = []
    for number, row in enumerate(pictured, start=1):
        filename = layout.visible_filename(f"{number:0{width}d} {row['title']}", ".png", row["proof"])
        files.append((row, case.resolve_inside(row["png"]), filename))
    name = layout.slugify((body.folder or "").strip() or Path(body.video).stem, "Slides")
    try:
        destination = exportdir.destination("proofs", case.path)
        folder = exportdir.copy_set([(png, filename) for _row, png, filename in files], destination, name)
    except exportdir.ExportDirError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {
        "folder": str(folder),
        "name": folder.name,
        "files": [
            {"proof": row["proof"], "title": row["title"], "file": filename}
            for row, _png, filename in files
        ],
        "skipped": skipped,
    }


@router.post("/cases/{case_id}/proofs/export/reveal")
def reveal_proof_exports(case_id: str) -> dict[str, str]:
    """Open the proofs export folder, resolved here rather than sent by the browser."""
    case = get_case(case_id)
    try:
        folder = exportdir.destination("proofs", case.path)
        reveal_engine.reveal(folder, workspace_only=False)
    except (exportdir.ExportDirError, reveal_engine.RevealError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"path": str(folder)}


@router.post("/cases/{case_id}/proofs")
def save_proof(case_id: str, body: ProofIn) -> dict[str, Any]:
    case = get_case(case_id)
    case.subdir("proofs")  # born on first save, so the visible folder exists
    bound = slugify(body.rename_from, "proof") if body.rename_from else None
    name = slugify(body.title, "Proof") if body.title.strip() else technical_name(
        case.subdir("proofs").joinpath(layout.META_DIR), "proof", bound
    )
    rel = layout.proof_spec_rel(name)
    spec_path = case.resolve_inside(rel)

    # A rename lands on a free name or not at all: taking a name another proof
    # holds would leave two entities pointing at one spec, and there is no sane
    # merge of the two. The first save of an unbound composer still writes over
    # a same-named proof — there the analyst is updating that one.
    # Taken is judged without case, the proof being saved excepted: two names that
    # differ only by case are one file on Windows and macOS.
    old = bound
    old_rel = layout.proof_spec_rel(old) if old and old != name else None
    if holders(spec_path.parent, name, source=old if old_rel else name):
        raise HTTPException(status_code=409, detail="another proof already uses that name")

    # Decoded up front: a bad batch must be refused before anything is written.
    incoming = _decode_assets(body.assets)
    # Read up front too: a published picture names a file this save reads and keeps.
    published = _published(body.spec)
    published_url = next((one["url"] for one in published or [] if one.get("url")), "")
    # Read up front for the same reason: a date outside the profile is refused
    # before the rename below moves this proof's export and its pasted images.
    zone = _stated_zone(body.spec)
    when = _stated_when(body.spec, zone)
    # A zone only means something beside the date it reads.
    when_zone = zone if when else None
    description = _stated_description(body.spec)
    credits = imagery_credits(body.spec)
    # The export too, and for a stronger reason: the rename below moves the proof
    # to its new name, so a payload refused after that point would leave it renamed
    # by a save that answered an error.
    png_bytes: bytes | None = None
    if body.png_base64:
        try:
            png_bytes = base64.b64decode(body.png_base64, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise HTTPException(status_code=422, detail="invalid PNG payload") from exc
        if len(png_bytes) > MAX_EXPORT_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"the export must be under {MAX_EXPORT_BYTES // 1024 // 1024} MB",
            )
        # the credits travel inside the file, wherever it is copied to
        png_bytes = with_credits(png_bytes, credits)

    # A rename lands first, on its own: the spec, the export and the pasted images
    # move to the new name, and every post, note, thread and record naming them
    # follows (`engine/renames.py`), a change of case included. The rest of the save
    # then writes onto the new name like any other, so a rename saved without fresh
    # pixels keeps the export the proof already had.
    renamed = bool(old_rel) and case.resolve_inside(str(old_rel)).is_file()
    if renamed:
        rename_engine.rename_record(case, "proof", str(old_rel), rel)
        spec_path = case.resolve_inside(rel)

    # A published picture nobody drew on is its own export, whatever the browser drew.
    # Read after the rename above, which carried its assets folder to this name.
    if published:
        own = published_export(
            {**body.spec, "published": published},
            incoming,
            case.resolve_inside(layout.proof_assets_rel(name)),
        )
        if own is not None:
            png_bytes = own

    # the export lands first: its thumbnail is recorded in the spec written below
    png_rel = thumb_rel = None
    if png_bytes is not None:
        case.resolve_inside(layout.proof_export_rel(name)).write_bytes(png_bytes)
        png_rel = layout.proof_export_rel(name)
        thumb_rel = _proof_thumb(case, name, png_bytes)
    elif renamed and case.resolve_inside(layout.proof_export_rel(name)).exists():
        png_rel = layout.proof_export_rel(name)
        thumb_rel = _proof_thumb(case, name)

    spec = dict(body.spec)
    spec["azimut_proof"] = 1
    spec["title"] = name
    if published is not None:
        spec["published"] = published
    spec["when"] = when or None
    # The pick, not the answer: left empty, the zone follows the point each save.
    spec["whenZone"] = _chosen_zone(body.spec)
    spec.pop("whenZoneStated", None)
    spec["description"] = description or None
    spec.setdefault("created_at", read_created_at(spec_path) or _now())
    # Where in its video the proof happens is stated through its own route
    # (`state_proof_scene`), so a save that does not name it keeps the one on disk:
    # the composer, the sheet and an import write the rest of the proof and never
    # this. One that does name it is read into its one shape.
    scene = scene_engine.read_scene(body.spec["scene"] if "scene" in body.spec else _stored_scene(spec_path))
    if scene is None:
        spec.pop("scene", None)
    else:
        spec["scene"] = scene
    spec["updated_at"] = _now()
    if png_rel:
        spec["thumb"] = thumb_rel

    _write_spec(spec_path, spec)

    # The spec is the truth about which pasted images the proof shows, so its
    # folder is reconciled against what we just wrote.
    _write_assets(
        case.resolve_inside(layout.proof_assets_rel(name)), incoming, _referenced_assets(spec)
    )

    # upsert the proof entity (analyst action → confirmed). A rename above has
    # rebound the entity the old name held rather than filing a second one, so the
    # proof keeps its folder, notes and links.
    existing = case.find_entity(attr="spec", value=rel)
    if existing:
        patch: dict[str, Any] = {"label": name}
        attrs: dict[str, Any] = {}
        if png_rel and existing["attrs"].get("path") != png_rel:
            # a spec-only proof exported later gains its PNG here — without the
            # path the sidebar preview and delete_by_path can't see the file
            attrs["path"] = png_rel
        # The thumbnail travels on the entity as well as in the spec, so a surface
        # drawing a proof beside other entities — the graph draws a few hundred at
        # once — reads it off the row it already has instead of opening one JSON
        # file per proof.
        if thumb_rel and existing["attrs"].get("thumb") != thumb_rel:
            attrs["thumb"] = thumb_rel
        # What the proof states about itself travels the same way, and for one more
        # reason than the thumbnail: `when` is what the Timeline projects the proof
        # from, and the description is the entity's notes — the text the Details
        # panel shows and case search finds. Written on every save, empty included,
        # since clearing the field is the analyst taking the statement back.
        if existing["attrs"].get("when", "") != when:
            attrs["when"] = when
        if existing["attrs"].get("when_zone") != when_zone:
            attrs["when_zone"] = when_zone
        if existing["attrs"].get("notes", "") != description:
            attrs["notes"] = description
        # kept for the record, printed only when the footer is asked to
        if existing["attrs"].get("imagery_credits", "") != credits:
            attrs["imagery_credits"] = credits
        # the post a published picture came from, so it is found without opening the spec
        if existing["attrs"].get(import_engine.PUBLISHED_URL, "") != published_url:
            attrs[import_engine.PUBLISHED_URL] = published_url
        # a proof given up on and saved with a place is proved: the word it was left with goes
        if existing["attrs"].get("abandoned") is not None and scene_engine.states_place(spec):
            attrs["abandoned"] = None
        if attrs:
            patch["attrs"] = attrs
        case.update_entity(existing["id"], patch)
        entity_id = existing["id"]
    else:
        entity_id = case.add_entity(
            "proof",
            name,
            attrs={
                "spec": rel,
                **({"path": png_rel} if png_rel else {}),
                **({"thumb": thumb_rel} if thumb_rel else {}),
                **({"when": when} if when else {}),
                **({"when_zone": when_zone} if when_zone else {}),
                **({"notes": description} if description else {}),
                **({"imagery_credits": credits} if credits else {}),
                **({import_engine.PUBLISHED_URL: published_url} if published_url else {}),
            },
            by="proof-composer",
        )["id"]

    # A proof is derived from what it composes *and* from what it rests on: the same
    # click that saves it files the chain (ONTOLOGY §3). Panels are the pictures laid
    # out on the canvas; `material` is the footage behind them — the clip a frame was
    # cut from, the second angle nothing was cropped out of — brought in from a source
    # address the analyst stated. Restated on every save, so a panel dropped from the
    # proof or an address taken off its list drops its edge too.
    #
    # The point follows on its own: `satellite.restate_proof_point` poses a proof's
    # place on its whole derivation closure, so material joins the map by being in the
    # chain rather than by a second rule written here.
    link_engine.sync(
        case,
        entity_id,
        link_engine.DERIVED_FROM,
        [p.get("src") for p in spec.get("panels", []) if p.get("src")] + _material_paths(spec),
        by="proof-composer",
    )

    # The chain has to be filed before this: the footage behind a panel is reached
    # by walking it, and a material address added in this same save is on it only
    # once the sync above has run.
    dated = _date_the_material(
        case,
        proof_id=entity_id,
        name=name,
        old=old,
        rel=rel,
        when=when,
        when_zone=when_zone,
        spec=spec,
    )

    place, released = _place_for(case, entity_id, spec)
    # The markers showing this proof in the analyst's layers say what it says now:
    # its description, day and sources, and the footage behind it is the same marker.
    layerediting.sync_followers(case, entity_id)
    # A picture marked to geolocate is proved once a proof lays it out: its geolocating
    # ends, and the queue may have lost a row.
    if geolocate.settle(case):
        say_geolocating(case)
    events.publish({"type": "scenes", "case_id": case.id, "video": None})
    return {
        # The proof's entity, so the composer can ask what it shares with the case.
        "id": entity_id,
        "name": name,
        "title": name,
        "png": png_rel,
        "thumb": thumb_rel,
        "spec_path": rel,
        "place": place,
        # The zone the date was read in, so a post handed this proof names its clock.
        "when_zone": when_zone,
        # The files this save stated the date for, so the composer can say so. A
        # save that writes into the graph announces it; it just does not ask.
        "dated": dated,
        # points this save moved off that nothing holds any more; the composer asks
        "orphans": [{"id": e["id"], "label": e["label"]} for e in released],
    }


#: The attribute that binds the dating statement below to the proof that made it.
#: Keyed by the spec path for the same reason the proof entity itself is found that
#: way: it is the one value a proof owns, and a rename carries it.
_STATED_BY = scene_engine.DATED_BY

#: What the statement holds when nothing but this save has touched it. A Claim that
#: has grown reasoning, a quote or a confidence is the analyst's own work by then,
#: and clearing a date in the composer must not delete it.
_OURS = {"when", "when_zone", "time_role", "span", _STATED_BY}


def _source_material(case: Case, spec: dict[str, Any]) -> list[dict[str, Any]]:
    """The collected files a proof rests on, each read back to its own origin.

    A proof composes a *frame*; the thing that was filmed is the video behind it, so
    the chain is walked up to whatever nothing else in the case derives from. Captures
    drop out at the end rather than at the start: a satellite screenshot is dated by
    the provider's flyover, not by the event, and its own panel may still stand
    between a crop and the imagery it came from.
    """
    paths = [p.get("src") for p in spec.get("panels", []) if p.get("src")]
    found, _missing = link_engine.resolve(case, paths + _material_paths(spec))
    return link_engine.collected_roots(case, found)


def _dated_material(
    case: Case, spec: dict[str, Any]
) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    """What a proof's date is about, and the moments of it, if the proof states any.

    A proof about a video (its ★, `scenes.star_video`) dates that video alone. An
    old clip often confirms a new fact, so another video among the panels, a photo or
    a second angle never takes the date. The span says where in the video: the
    moments the proof states, and none for the whole of it. A proof that rests on no
    video dates everything it rests on, as it always has.
    """
    video, moments = scene_engine.star_video(case, spec)
    if video is None:
        return _source_material(case, spec), None
    found, _missing = link_engine.resolve(case, [video])
    span = {"path": video, "moments": moments} if moments else None
    return link_engine.collected_roots(case, found), span


def _date_the_material(
    case: Case,
    *,
    proof_id: str,
    name: str,
    old: str | None,
    rel: str,
    when: str,
    spec: dict[str, Any],
    when_zone: str | None = None,
) -> list[str]:
    """State the proof's date for the footage it rests on, and answer with what it hit.

    The date belongs to the material, not to the document arguing about it: a video
    was shot when it was shot, whichever proof says so. It travels as a Claim — the
    one shape this case has for *an analyst concluded this* — so it carries who said
    it and what it rests on, and it never writes over the clock the file itself
    reports. Both readings then sit side by side on that file's Time panel, the
    statement above the file's own dates.

    One statement per proof. A proof about a video states its date for that video
    alone, over the moments it shows the place in (``span``); one that rests on no
    video states it about every source at once. A proof states one date, and one
    statement about three files says exactly that, where three statements would read
    as three findings and would have to be kept in step by hand.
    """
    standing = case.find_entity(attr=_STATED_BY, value=rel)
    if standing is not None and standing.get("type") != "claim":
        standing = None
    sources, span = _dated_material(case, spec) if when else ([], None)
    if not sources:
        # The date is gone, or nothing collected is left under the proof. The
        # statement goes with it — unless it has grown past what this save wrote,
        # which makes it the analyst's and not ours to delete.
        if standing is not None and set(standing.get("attrs") or {}) <= _OURS:
            delete_entity_deep(case, standing["id"])
        return []
    # The wording is this save's only while nobody has rewritten it. A statement
    # reworded by hand is the analyst's sentence, and restating the date is no
    # reason to put our own back over it.
    written = {scene_engine.dating_label(name), scene_engine.dating_label(old)} if old else {scene_engine.dating_label(name)}
    label = standing["label"] if standing and standing["label"] not in written else scene_engine.dating_label(name)
    case.save_temporal_claim(
        entity_id=standing["id"] if standing else None,
        label=label,
        attrs={
            **{
                key: value
                for key, value in ((standing or {}).get("attrs") or {}).items()
                if key not in _OURS
            },
            "when": when,
            # Read on the same clock the proof states it on, so the footage's day
            # is the day of the place it shows.
            **({"when_zone": when_zone} if when_zone else {}),
            # What the file shows, as read by whoever composed the proof. The same
            # role the Timeline's own "this media was captured" correction uses.
            "time_role": "observed",
            # where in the video, when the proof says
            **({"span": span} if span else {}),
            _STATED_BY: rel,
        },
        connectors={"about": [e["id"] for e in sources], "at": [], "cites": [proof_id]},
        by="proof-composer",
    )
    return [str(e.get("label") or "") for e in sources]


def _restate_dated_moments(case: Case, name: str) -> None:
    """Carry a proof's new moments, or its new ★ video, onto the date it states.

    The scene route writes the time and nothing else, so only what the time decides
    moves: the span and the video the statement is about. Its date, its words and
    whatever the analyst added stay as they are, and a proof that states no date yet
    gets none here: its next save states it.
    """
    rel = layout.proof_spec_rel(name)
    standing = case.find_entity(attr=_STATED_BY, value=rel)
    proof = case.find_entity(attr="spec", value=rel)
    if standing is None or standing.get("type") != "claim" or proof is None:
        return
    sources, span = _dated_material(case, read_spec(case, proof))
    if not sources:
        return
    attrs = dict(standing.get("attrs") or {})
    attrs.pop("span", None)
    if span:
        attrs["span"] = span
    about = [e["id"] for e in sources]
    held = [
        link["to"]
        for link in case.links_of(standing["id"])
        if link["type"] == "about" and link["from"] == standing["id"]
    ]
    if attrs == (standing.get("attrs") or {}) and sorted(held) == sorted(about):
        return
    case.save_temporal_claim(
        entity_id=standing["id"],
        label=standing["label"],
        attrs=attrs,
        connectors={"about": about},
        by="proof-composer",
    )


def _material_paths(spec: dict[str, Any]) -> list[str]:
    """The case files a proof states it rests on.

    Each entry is the file and the address that brought it in, which is what lets the
    composer take a source off a proof and take its files out of the chain with it. A
    bare string is what a proof saved before that carried: a file no address answers
    for, kept as one.
    """
    held: list[str] = []
    for entry in spec.get("material", []):
        rel = entry if isinstance(entry, str) else (entry or {}).get("path")
        if isinstance(rel, str) and rel:
            held.append(rel)
    return held


def _place_for(
    case: Case, proof_id: str, spec: dict[str, Any]
) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    """File the points this proof carries, or hand the composer the question.

    A proof is where a geolocation is concluded, so its points are what become
    nodes — here, rather than on every capture taken while looking for them.
    ``proof_place_auto`` decides which of the two happens; neither is a
    suggestion, because both spell out the analyst's own answer.

    Every path restates what the proof says (``satellite.restate_proof_point``),
    which is what makes a *re*-save mean something: corrected coordinates move the
    edges instead of adding a second set, a point taken off the list rends its
    place, and POV moved to another line changes both verbs. The first half of the
    answer is what the composer has to report — what was filed, and what it must
    ask about — ``None`` when there is neither, so **a point the case already holds
    is neither filed twice nor asked about** and a proof re-saved untouched stays
    silent while still restating what it says. The second half is the points it let
    go of.
    """
    return _state_points(
        case,
        proof_id,
        satellite_engine.spec_points(spec),
        auto=bool(config.load_settings().get("proof_place_auto", True)),
    )


def _state_points(
    case: Case, proof_id: str, points: list[dict[str, Any]], *, auto: bool
) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    """File what has nowhere to live yet, then state the whole list at once.

    **Only the conclusion is looked up.** Geography costs a paced Nominatim call
    (``engine/geo._pace``), so three points would hold the save for three seconds
    to answer a question the Locate pass answers for free: the first point is
    resolved because the analyst is about to look at it, and the rest are born
    unlocated for that pass to pick up, exactly as an offline save already is.

    **A point nobody checked is never filed** (``proposed``, see
    ``satellite.spec_points``): it is the middle of a capture, and filing it would
    put a guess on the case map as a conclusion. It is not asked about either, since
    the composer just offered to check it and heard "later". A place the case
    already holds there stays, so an older proof re-saved unchecked keeps its point.
    """
    stated: list[dict[str, Any]] = []
    filed: list[dict[str, Any]] = []
    asking: list[dict[str, Any]] = []
    for rank, point in enumerate(points):
        standing = satellite_engine.place_at(case, point["lat"], point["lon"], keyed_only=False)
        if standing is not None:
            stated.append({"id": standing["id"], "pov": point["pov"]})
            continue
        if point.get("proposed"):
            continue
        if not auto:
            # the point moved somewhere the case cannot hold yet: the old claim is
            # withdrawn either way, and the new one waits on the analyst's yes
            asking.append(
                {
                    "lat": point["lat"],
                    "lon": point["lon"],
                    "label": point["label"],
                    # so the question can say what the point will mean
                    "pov": point["pov"],
                }
            )
            continue
        place = satellite_engine.place_for_proof(case, point)
        if rank == 0:
            locate_on_save(case, place["id"], point["lat"], point["lon"])
        stated.append({"id": place["id"], "pov": point["pov"]})
        filed.append({"id": place["id"], "label": place["label"]})
    released = satellite_engine.restate_proof_point(case, proof_id, stated)
    answer = {"filed": filed, "asking": asking} if (filed or asking) else None
    return answer, released


def file_proof_points(case: Case, proof: dict[str, Any]) -> list[dict[str, Any]]:
    """File every point a saved proof states, whatever the setting says.

    The composer's yes, and the sheet's way of filing a point the composer would
    have asked about. The spec on disk is the authority — it was written a moment
    ago by the save that raised the question, and re-reading it is what keeps the
    answer about the proof rather than about whatever the caller still held.
    """
    points = satellite_engine.spec_points(read_spec(case, proof))
    answer, _released = _state_points(case, proof["id"], points, auto=True)
    return (answer or {}).get("filed", [])


@router.post("/cases/{case_id}/proofs/{name}/place")
def save_proof_place(case_id: str, name: str) -> list[dict[str, Any]]:
    """File the points of a proof the composer just asked the analyst about.

    The other half of ``proof_place_auto`` being off: the save reported points with
    nowhere to live, the composer asked, and this is the yes. Everything is read
    off the spec rather than taken from the request — the points, their labels,
    which one is POV — so two open tabs answering the same question file one set of
    places rather than two, and a point somebody filed in between is joined instead
    of minted again.
    """
    case = get_case(case_id)
    proof = case.find_entity(attr="spec", value=layout.proof_spec_rel(slugify(name, "proof")))
    if proof is None:
        raise HTTPException(status_code=404, detail="no such proof")
    return file_proof_points(case, proof)


@router.put("/cases/{case_id}/proofs/{name}/scene")
def state_proof_scene(case_id: str, name: str, body: SceneIn) -> dict[str, Any]:
    """Say when in its video a proof happens. Writes the proof's scene, and the moments
    the date it states is about (`_restate_dated_moments`)."""
    case = get_case(case_id)
    try:
        case.resolve_inside(layout.proof_spec_rel(name))
    except CaseError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    try:
        scene = scene_engine.state_proof_scene(case, name, body.moments, body.video, body.draft, body.traced)
    except scene_engine.UnknownProof as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except scene_engine.BadScene as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except CaseError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    # The date the proof states is about its moments: they moved, so it follows.
    _restate_dated_moments(case, name)
    # A scene a proof takes up is proved: its geolocating is over, and it leaves the queue.
    if scene.get("draft") and geolocate.stop(case, scene["draft"]):
        say_geolocating(case)
    events.publish({"type": "scenes", "case_id": case.id, "video": scene.get("video")})
    return scene


def read_spec(case: Case, proof: dict[str, Any]) -> dict[str, Any]:
    """The saved spec of a proof, or an empty one if it cannot be read."""
    rel = (proof.get("attrs") or {}).get("spec")
    if not isinstance(rel, str) or not rel:
        return {}
    try:
        loaded = json.loads(case.resolve_inside(rel).read_text(encoding="utf-8"))
    except (OSError, ValueError, CaseError):
        return {}
    return loaded if isinstance(loaded, dict) else {}


@router.delete("/cases/{case_id}/proofs/{name}")
def delete_proof(case_id: str, name: str, scene: Literal["keep", "drop"] = "keep") -> dict[str, Any]:
    """Send a proof to the Trash. Its scene goes back to its video's work to geolocate
    again (``scene=keep``, `scenes.give_back`), or with ``scene=drop`` it goes with the
    proof: the scenes to prove it took up or gave back leave the work, and none is given
    back. Both in one go under the case's lock, the scenes put back if the delete fails.
    Restored, the proof states its moments as it did, so nothing is lost but the draft."""
    case = get_case(case_id)
    # Named the way the save named it — see `api/satellite.delete_search_grid`.
    rel = layout.proof_spec_rel(slugify(name, "proof"))
    try:
        case.resolve_inside(rel)
    except CaseError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    drop = scene == "drop"
    with case.lock:
        video, cited = scene_engine.scenes_cited(case, rel)
        taken = inspectwork.remove_scenes(case, cited) if drop else []
        try:
            result = delete_by_path(case, rel, give_back=not drop)
            if not result["deleted"]:  # never filed as an entity: drop the files anyway
                # The registry knows what a proof owns — spec, export and the pasted
                # images beside them — so this path and the chokepoint cannot drift.
                artifact_engine.delete(case, {"type": "proof", "attrs": {"spec": rel}})
        except Exception:
            inspectwork.put_back_scenes(case, taken)
            raise
        dropped = [s["id"] for _subject, gone in taken for s in gone]
    if video:
        # its scene went back to the work, or left it: the strip, Inspect and the queue read again
        events.publish({"type": "scenes", "case_id": case.id, "video": video})
    return {**result, "scene": scene, "dropped": dropped}
