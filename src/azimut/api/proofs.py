"""REST API for proofs: save (PNG + re-editable JSON spec), list, load, delete.

The spec is the source of truth — a proof saved once reopens for re-editing
(spec §6 v1). The PNG is the publishable export of that spec.
"""

from __future__ import annotations

import base64
import binascii
import json
import re
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..workspace import CaseError
from .cases import get_case

router = APIRouter(prefix="/api", tags=["proofs"])


class ProofIn(BaseModel):
    name: str | None = None  # slug; None → derived from title
    title: str = Field(min_length=1, max_length=200)
    spec: dict[str, Any]
    png_base64: str | None = None  # rendered export, data URL body


def _slug(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug[:80] or "proof"


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


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
        proofs.append(
            {
                "name": name,
                "title": spec.get("title", name),
                "updated_at": spec.get("updated_at"),
                "panels": len(spec.get("panels", [])),
                "shapes": len(spec.get("shapes", [])),
                "png": f"proofs/{png.name}" if png.exists() else None,
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
    name = _slug(body.name or body.title)
    proofs_dir = case.subdir("proofs")

    spec = dict(body.spec)
    spec["azimut_proof"] = 1
    spec["title"] = body.title
    spec.setdefault("created_at", _now())
    spec["updated_at"] = _now()

    spec_path = proofs_dir / f"{name}.json"
    spec_path.write_text(
        json.dumps(spec, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    png_rel = None
    if body.png_base64:
        try:
            png_bytes = base64.b64decode(body.png_base64, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise HTTPException(status_code=422, detail="invalid PNG payload") from exc
        (proofs_dir / f"{name}.png").write_bytes(png_bytes)
        png_rel = f"proofs/{name}.png"

    # upsert the proof entity (analyst action → confirmed)
    existing = case.find_entity(attr="spec", value=f"proofs/{name}.json")
    if existing:
        case.update_entity(existing["id"], {"label": body.title})
    else:
        case.add_entity(
            "proof",
            body.title,
            attrs={"spec": f"proofs/{name}.json", **({"path": png_rel} if png_rel else {})},
            by="proof-composer",
        )

    return {"name": name, "png": png_rel, "spec_path": f"proofs/{name}.json"}


@router.delete("/cases/{case_id}/proofs/{name}")
def delete_proof(case_id: str, name: str) -> dict[str, str]:
    case = get_case(case_id)
    try:
        spec_path = case.resolve_inside(f"proofs/{name}.json")
    except CaseError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    spec_path.unlink(missing_ok=True)
    spec_path.with_suffix(".png").unlink(missing_ok=True)
    entity = case.find_entity(attr="spec", value=f"proofs/{name}.json")
    if entity:
        case.remove_entity(entity["id"])
    return {"status": "deleted"}
