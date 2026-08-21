"""REST API for proofs: save (PNG + re-editable JSON spec), list, load, delete.

The spec is the source of truth — a proof saved once reopens for re-editing
(spec §6 v1). The PNG is the publishable export of that spec, and its cached
thumbnail is what the open dialog shows.

A proof may also hold pasted images: pixels that belong to the composition
alone, with no source in the case. They live in a ``<name>.assets`` folder
beside the spec, named by their own hash, and they are never filed as media or
as an entity — nothing in the graph claims a paste came from anywhere.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import config
from ..engine import artifacts as artifact_engine
from ..engine import exportdir
from ..engine import links as link_engine
from ..engine import media as media_engine
from ..engine import reveal as reveal_engine
from ..engine import satellite as satellite_engine
from ..engine import thumbnails as thumbnail_engine
from ..workspace import Case, CaseError, ensure_dir
from .cases import delete_by_path, get_case
from .drafts import list_drafts
from .naming import read_created_at, slugify
from .satellite import locate_on_save
from .. import layout

router = APIRouter(prefix="/api", tags=["proofs"])


ASSETS_SUFFIX = ".assets"
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
    # those files in place instead of leaving a copy under the old name.
    rename_from: str | None = None
    title: str = Field(min_length=1, max_length=200)
    spec: dict[str, Any]
    # The rendered export, as the data URL's body. Bounded twice: the whole request by
    # `server.BulkBodyLimit`, and the decoded picture by `MAX_EXPORT_BYTES` below.
    png_base64: str | None = None
    # Pasted images the spec references but the case does not hold yet. They ride
    # along with the save rather than through an upload of their own, so a proof
    # the analyst never saves leaves nothing behind.
    assets: list[AssetIn] = Field(default_factory=list)


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _write_spec(path: Path, spec: dict[str, Any]) -> None:
    ensure_dir(path.parent)
    path.write_text(json.dumps(spec, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


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
    """Asset filenames the spec still shows."""
    pastes = spec.get("pastes")
    if not isinstance(pastes, list):
        return set()
    return {
        p["asset"] for p in pastes if isinstance(p, dict) and isinstance(p.get("asset"), str)
    }


def _move_assets(src: Path, dst: Path) -> None:
    """Carry a proof's assets folder over to its new name.

    Windows refuses to rename onto an existing directory, so anything already
    sitting at the destination is moved aside and deleted last.
    """
    if not src.is_dir():
        return
    if dst.exists():
        stale = dst.with_name(dst.name + ".stale")
        shutil.rmtree(stale, ignore_errors=True)
        dst.rename(stale)
        src.rename(dst)
        shutil.rmtree(stale, ignore_errors=True)
    else:
        src.rename(dst)


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


@router.get("/cases/{case_id}/proofs/index")
def proof_index(case_id: str) -> list[dict[str, Any]]:
    """Proofs as map rows, for the Saved panel's Proofs position.

    Declared above ``/proofs/{name}`` so ``index`` is read as this route and not
    as a proof called "index". Lazy by design: the Saved panel loads it the
    first time that position is opened, never on case open.
    """
    case = get_case(case_id)
    return satellite_engine.proof_index(case, list_proofs(case_id), list_drafts(case_id))


@router.get("/cases/{case_id}/proofs")
def list_proofs(case_id: str) -> list[dict[str, Any]]:
    case = get_case(case_id)
    proofs = []
    for spec_path in sorted(case.subdir("proofs").joinpath(layout.META_DIR).glob("*.json")):
        try:
            spec = json.loads(spec_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if spec.get("azimut_proof") != 1:
            continue
        name = spec_path.stem
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
        proofs.append(
            {
                "name": name,
                "title": spec.get("title", name),
                "updated_at": spec.get("updated_at"),
                "panels": len(spec.get("panels", [])),
                "shapes": len(spec.get("shapes", [])),
                # the points the proof states for itself, read before its
                # derivation so it keeps them when the capture is deleted
                "points": satellite_engine.spec_points(spec),
                "png": layout.proof_export_rel(png.stem) if png.exists() else None,
                "thumb": thumb,
                "spec_path": layout.proof_spec_rel(spec_path.stem),
            }
        )
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
        return satellite_engine.open_spec(case, proof["id"], spec)
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
    name = slugify(body.title, "Proof")
    case.subdir("proofs")  # born on first save, so the visible folder exists
    rel = layout.proof_spec_rel(name)
    spec_path = case.resolve_inside(rel)

    # A rename lands on a free name or not at all: taking a name another proof
    # holds would leave two entities pointing at one spec, and there is no sane
    # merge of the two. The first save of an unbound composer still writes over
    # a same-named proof — there the analyst is updating that one.
    old = slugify(body.rename_from, "proof") if body.rename_from else None
    old_rel = layout.proof_spec_rel(old) if old and old != name else None
    if old_rel and spec_path.exists():
        raise HTTPException(status_code=409, detail="another proof already uses that name")

    # Decoded up front: a bad batch must be refused before anything is written.
    incoming = _decode_assets(body.assets)
    # The export too, and for a stronger reason — the rename below deletes the
    # old PNG and moves the assets folder, so a payload refused after that point
    # would leave the proof under its old name with both of them gone.
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

    # The export moves with the spec, so a rename saved without fresh pixels
    # keeps the PNG the proof already had rather than dropping it.
    if old_rel and old:
        old_png = case.resolve_inside(layout.proof_export_rel(old))
        if old_png.exists():
            if png_bytes is not None:
                old_png.unlink()
            else:
                old_png.replace(case.resolve_inside(layout.proof_export_rel(name)))
        # the pasted images follow the proof, exactly as its export does
        _move_assets(
            case.resolve_inside(layout.proof_assets_rel(old)),
            case.resolve_inside(layout.proof_assets_rel(name)),
        )

    # the export lands first: its thumbnail is recorded in the spec written below
    png_rel = thumb_rel = None
    if png_bytes is not None:
        case.resolve_inside(layout.proof_export_rel(name)).write_bytes(png_bytes)
        png_rel = layout.proof_export_rel(name)
        thumb_rel = _proof_thumb(case, name, png_bytes)
    elif old_rel and case.resolve_inside(layout.proof_export_rel(name)).exists():
        png_rel = layout.proof_export_rel(name)
        thumb_rel = _proof_thumb(case, name)

    spec = dict(body.spec)
    spec["azimut_proof"] = 1
    spec["title"] = name
    previous = case.resolve_inside(layout.proof_spec_rel(old or name))
    spec.setdefault("created_at", read_created_at(previous) or _now())
    spec["updated_at"] = _now()
    if png_rel:
        spec["thumb"] = thumb_rel

    _write_spec(spec_path, spec)

    # The spec is the truth about which pasted images the proof shows, so its
    # folder is reconciled against what we just wrote.
    _write_assets(
        case.resolve_inside(layout.proof_assets_rel(name)), incoming, _referenced_assets(spec)
    )

    # upsert the proof entity (analyst action → confirmed). A rename rebinds the
    # entity the old name held rather than filing a second one, so the proof
    # keeps its folder, notes and links.
    existing = case.find_entity(attr="spec", value=old_rel or rel)
    if existing:
        patch: dict[str, Any] = {"label": name}
        attrs: dict[str, Any] = {"spec": rel} if old_rel else {}
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
            },
            by="proof-composer",
        )["id"]
    if old_rel:
        case.resolve_inside(layout.proof_spec_rel(str(old))).unlink(missing_ok=True)

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

    place, released = _place_for(case, entity_id, spec)
    return {
        "name": name,
        "title": name,
        "png": png_rel,
        "thumb": thumb_rel,
        "spec_path": rel,
        "place": place,
        # points this save moved off that nothing holds any more; the composer asks
        "orphans": [{"id": e["id"], "label": e["label"]} for e in released],
    }


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
    """
    stated: list[dict[str, Any]] = []
    filed: list[dict[str, Any]] = []
    asking: list[dict[str, Any]] = []
    for rank, point in enumerate(points):
        standing = satellite_engine.place_at(case, point["lat"], point["lon"], keyed_only=False)
        if standing is not None:
            stated.append({"id": standing["id"], "pov": point["pov"]})
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
def delete_proof(case_id: str, name: str) -> dict[str, Any]:
    case = get_case(case_id)
    # Named the way the save named it — see `api/satellite.delete_search_grid`.
    rel = layout.proof_spec_rel(slugify(name, "proof"))
    try:
        case.resolve_inside(rel)
    except CaseError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    result = delete_by_path(case, rel)
    if not result["deleted"]:  # never filed as an entity: drop the files anyway
        # The registry knows what a proof owns — spec, export and the pasted
        # images beside them — so this path and the chokepoint cannot drift.
        artifact_engine.delete(case, {"type": "proof", "attrs": {"spec": rel}})
    return result
