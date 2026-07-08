"""REST API for post drafts: save, list, load, delete.

A draft is the re-editable state of the Post Composer (thread of tweets built
from a geolocation). Drafts live in ``<case>/exports/`` as JSON and are indexed
as ``post`` entities so they show up in the case sidebar (spec §4 — the case is
the product). Ozimut never posts on your behalf; a draft is prepared here and the
human publishes it (spec §6 non-goals).
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..workspace import CaseError
from .cases import get_case

router = APIRouter(prefix="/api", tags=["drafts"])

DRAFT_MARKER = 1


class DraftIn(BaseModel):
    name: str | None = None  # slug; None → derived from title
    title: str = Field(min_length=1, max_length=200)
    state: dict[str, Any]  # opaque Post Composer state (fields + tweets)


def _slug(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug[:80] or "draft"


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@router.get("/cases/{case_id}/drafts")
def list_drafts(case_id: str) -> list[dict[str, Any]]:
    case = get_case(case_id)
    drafts = []
    for path in sorted(case.subdir("exports").glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if data.get("ozimut_draft") != DRAFT_MARKER:
            continue
        drafts.append(
            {
                "name": path.stem,
                "title": data.get("title", path.stem),
                "updated_at": data.get("updated_at"),
                "created_at": data.get("created_at"),
            }
        )
    drafts.sort(key=lambda d: d.get("updated_at") or "", reverse=True)
    return drafts


@router.get("/cases/{case_id}/drafts/{name}")
def load_draft(case_id: str, name: str) -> dict[str, Any]:
    case = get_case(case_id)
    try:
        path = case.resolve_inside(f"exports/{name}.json")
    except CaseError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if not path.exists():
        raise HTTPException(status_code=404, detail="draft not found")
    return json.loads(path.read_text(encoding="utf-8"))


@router.post("/cases/{case_id}/drafts")
def save_draft(case_id: str, body: DraftIn) -> dict[str, Any]:
    case = get_case(case_id)
    name = _slug(body.name or body.title)
    exports_dir = case.subdir("exports")

    path = exports_dir / f"{name}.json"
    existing_created = None
    if path.exists():
        try:
            existing_created = json.loads(path.read_text(encoding="utf-8")).get("created_at")
        except (OSError, json.JSONDecodeError):
            existing_created = None

    data = {
        "ozimut_draft": DRAFT_MARKER,
        "title": body.title,
        "created_at": existing_created or _now(),
        "updated_at": _now(),
        "state": body.state,
    }
    path.write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    # upsert the post entity (analyst action → confirmed)
    existing = case.find_entity(attr="draft", value=f"exports/{name}.json")
    if existing:
        case.update_entity(existing["id"], {"label": body.title})
    else:
        case.add_entity(
            "post",
            body.title,
            attrs={"draft": f"exports/{name}.json"},
            by="post-composer",
        )

    return {"name": name, "draft": f"exports/{name}.json"}


@router.delete("/cases/{case_id}/drafts/{name}")
def delete_draft(case_id: str, name: str) -> dict[str, str]:
    case = get_case(case_id)
    try:
        path = case.resolve_inside(f"exports/{name}.json")
    except CaseError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    path.unlink(missing_ok=True)
    entity = case.find_entity(attr="draft", value=f"exports/{name}.json")
    if entity:
        case.remove_entity(entity["id"])
    return {"status": "deleted"}
