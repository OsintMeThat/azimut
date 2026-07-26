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

from ..engine import links as link_engine
from ..engine import media as media_engine
from ..engine import satellite as satellite_engine
from ..engine import thumbnails as thumbnail_engine
from ..workspace import Case, CaseError
from .cases import delete_by_path, get_case
from .drafts import list_drafts
from .naming import read_created_at, slugify

router = APIRouter(prefix="/api", tags=["proofs"])


ASSETS_SUFFIX = ".assets"
ASSET_NAME = re.compile(r"^[0-9a-f]{16}\.(?:png|jpe?g|webp)$")
MAX_ASSET_BYTES = 20 * 1024 * 1024
MAX_ASSETS = 12


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
    # spec and its export. ``rename_from`` is the slug the composer is currently
    # bound to (absent on a first save); a save that lands elsewhere renames
    # those files in place instead of leaving a copy under the old name.
    rename_from: str | None = None
    title: str = Field(min_length=1, max_length=200)
    spec: dict[str, Any]
    png_base64: str | None = None  # rendered export, data URL body
    # Pasted images the spec references but the case does not hold yet. They ride
    # along with the save rather than through an upload of their own, so a proof
    # the analyst never saves leaves nothing behind.
    assets: list[AssetIn] = Field(default_factory=list)


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _write_spec(path: Path, spec: dict[str, Any]) -> None:
    path.write_text(json.dumps(spec, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _proof_thumb(case: Case, name: str, data: bytes | None = None) -> str | None:
    """Cached thumbnail for a proof's export, or None if it can't be produced.

    The export is a full-resolution PNG, far too heavy for the open dialog's
    rows. It goes through the media thumbnail cache: content-addressed, so two
    identical exports share one file and a re-export lands on a new immutable
    URL, and disposable, so eviction just means the next listing regenerates it.
    ``data`` skips re-reading bytes we already hold (the save path).
    """
    png_rel = f"proofs/{name}.png"
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
        folder.mkdir(parents=True, exist_ok=True)
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
    for spec_path in sorted(case.subdir("proofs").glob("*.json")):
        try:
            spec = json.loads(spec_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if spec.get("azimut_proof") != 1:
            continue
        name = spec_path.stem
        png = spec_path.with_suffix(".png")
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
                # the point the proof states for itself, read before its
                # derivation so it keeps it when the capture is deleted
                "coords": satellite_engine.own_point(spec),
                "png": f"proofs/{png.name}" if png.exists() else None,
                "thumb": thumb,
                "spec_path": f"proofs/{spec_path.name}",
            }
        )
    proofs.sort(key=lambda p: p.get("updated_at") or "", reverse=True)
    return proofs


@router.get("/cases/{case_id}/proofs/{name}")
def load_proof(case_id: str, name: str) -> dict[str, Any]:
    case = get_case(case_id)
    try:
        spec_path = case.resolve_inside(f"proofs/{name}.json")
    except CaseError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if not spec_path.exists():
        raise HTTPException(status_code=404, detail="proof not found")
    return json.loads(spec_path.read_text(encoding="utf-8"))


@router.post("/cases/{case_id}/proofs")
def save_proof(case_id: str, body: ProofIn) -> dict[str, Any]:
    case = get_case(case_id)
    name = slugify(body.title, "proof")
    proofs_dir = case.subdir("proofs")
    rel = f"proofs/{name}.json"
    spec_path = proofs_dir / f"{name}.json"

    # A rename lands on a free name or not at all: taking a name another proof
    # holds would leave two entities pointing at one spec, and there is no sane
    # merge of the two. The first save of an unbound composer still writes over
    # a same-named proof — there the analyst is updating that one.
    old = slugify(body.rename_from, "proof") if body.rename_from else None
    old_rel = f"proofs/{old}.json" if old and old != name else None
    if old_rel and spec_path.exists():
        raise HTTPException(status_code=409, detail="another proof already uses that name")

    # Decoded up front: a bad batch must be refused before anything is written.
    incoming = _decode_assets(body.assets)

    # The export moves with the spec, so a rename saved without fresh pixels
    # keeps the PNG the proof already had rather than dropping it.
    if old_rel:
        old_png = proofs_dir / f"{old}.png"
        if old_png.exists():
            if body.png_base64:
                old_png.unlink()
            else:
                old_png.replace(proofs_dir / f"{name}.png")
        # the pasted images follow the proof, exactly as its export does
        _move_assets(
            proofs_dir / f"{old}{ASSETS_SUFFIX}", proofs_dir / f"{name}{ASSETS_SUFFIX}"
        )

    # the export lands first: its thumbnail is recorded in the spec written below
    png_rel = thumb_rel = None
    if body.png_base64:
        try:
            png_bytes = base64.b64decode(body.png_base64, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise HTTPException(status_code=422, detail="invalid PNG payload") from exc
        (proofs_dir / f"{name}.png").write_bytes(png_bytes)
        png_rel = f"proofs/{name}.png"
        thumb_rel = _proof_thumb(case, name, png_bytes)
    elif old_rel and (proofs_dir / f"{name}.png").exists():
        png_rel = f"proofs/{name}.png"
        thumb_rel = _proof_thumb(case, name)

    spec = dict(body.spec)
    spec["azimut_proof"] = 1
    spec["title"] = body.title
    spec.setdefault("created_at", read_created_at(proofs_dir / f"{old or name}.json") or _now())
    spec["updated_at"] = _now()
    if png_rel:
        spec["thumb"] = thumb_rel

    _write_spec(spec_path, spec)

    # The spec is the truth about which pasted images the proof shows, so its
    # folder is reconciled against what we just wrote.
    _write_assets(
        proofs_dir / f"{name}{ASSETS_SUFFIX}", incoming, _referenced_assets(spec)
    )

    # upsert the proof entity (analyst action → confirmed). A rename rebinds the
    # entity the old name held rather than filing a second one, so the proof
    # keeps its folder, notes and links.
    existing = case.find_entity(attr="spec", value=old_rel or rel)
    if existing:
        patch: dict[str, Any] = {"label": body.title}
        attrs: dict[str, Any] = {"spec": rel} if old_rel else {}
        if png_rel and existing["attrs"].get("path") != png_rel:
            # a spec-only proof exported later gains its PNG here — without the
            # path the sidebar preview and delete_by_path can't see the file
            attrs["path"] = png_rel
        if attrs:
            patch["attrs"] = attrs
        case.update_entity(existing["id"], patch)
        entity_id = existing["id"]
    else:
        entity_id = case.add_entity(
            "proof",
            body.title,
            attrs={"spec": rel, **({"path": png_rel} if png_rel else {})},
            by="proof-composer",
        )["id"]
    if old_rel:
        (proofs_dir / f"{old}.json").unlink(missing_ok=True)

    # A proof is derived from the panels it composes: the same click that saves
    # it files the chain (ONTOLOGY §3). Restated on every save, so a panel
    # dropped from the proof drops its edge too.
    link_engine.sync(
        case,
        entity_id,
        link_engine.DERIVED_FROM,
        [p.get("src") for p in spec.get("panels", []) if p.get("src")],
        by="proof-composer",
    )

    return {
        "name": name,
        "png": png_rel,
        "thumb": thumb_rel,
        "spec_path": rel,
    }


@router.delete("/cases/{case_id}/proofs/{name}")
def delete_proof(case_id: str, name: str) -> dict[str, Any]:
    case = get_case(case_id)
    try:
        spec_path = case.resolve_inside(f"proofs/{name}.json")
    except CaseError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    result = delete_by_path(case, f"proofs/{name}.json")
    if not result["deleted"]:  # never filed as an entity: drop the files anyway
        spec_path.unlink(missing_ok=True)
        spec_path.with_suffix(".png").unlink(missing_ok=True)
    # The graph knows the spec and the export; the pasted images are known only
    # by where they sit, so they are dropped here either way.
    shutil.rmtree(spec_path.with_suffix(ASSETS_SUFFIX), ignore_errors=True)
    return result
