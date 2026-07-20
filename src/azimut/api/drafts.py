"""REST API for post drafts: save, list, load, delete.

A draft is the re-editable state of the Post Composer (thread of tweets built
from a geolocation). Drafts live in ``<case>/exports/`` as JSON and are indexed
as ``post`` entities so they show up in the case sidebar (spec §4 — the case is
the product). Azimut never posts on your behalf; a draft is prepared here and the
human publishes it (spec §6 non-goals).
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import PurePosixPath, PureWindowsPath
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..engine import links as link_engine
from ..workspace import CaseError
from .cases import delete_by_path, get_case

router = APIRouter(prefix="/api", tags=["drafts"])

DRAFT_MARKER = 1
MAX_MEDIA_PER_POST = 4
MAX_EXTRA_POSTS = 20
MAX_DRAFT_ATTACHMENTS = 1 + MAX_MEDIA_PER_POST * (1 + MAX_EXTRA_POSTS)
MAX_ARTIFACT_PATH_LENGTH = 512


class DraftIn(BaseModel):
    name: str | None = None  # slug; None → derived from title
    title: str = Field(min_length=1, max_length=200)
    state: dict[str, Any]  # opaque Post Composer state (fields + tweets)


def _slug(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug[:80] or "draft"


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _artifact_path(value: Any, field: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or not value or len(value) > MAX_ARTIFACT_PATH_LENGTH:
        raise HTTPException(status_code=422, detail=f"{field} must be a bounded path string")
    if (
        "\\" in value
        or "\x00" in value
        or PurePosixPath(value).is_absolute()
        or PureWindowsPath(value).is_absolute()
        or bool(PureWindowsPath(value).drive)
        or value == "."
        or ".." in PurePosixPath(value).parts
    ):
        raise HTTPException(status_code=422, detail=f"{field} must be case-relative")
    return value


def _media_paths(state: dict[str, Any], field: str) -> list[str]:
    current = state.get("mediaPaths")
    if current is None:
        current = [] if state.get("mediaPath") is None else [state.get("mediaPath")]
    if not isinstance(current, list):
        raise HTTPException(status_code=422, detail=f"{field}.mediaPaths must be an array")
    if len(current) > MAX_MEDIA_PER_POST:
        raise HTTPException(
            status_code=422,
            detail=f"{field}.mediaPaths allows at most {MAX_MEDIA_PER_POST} paths",
        )
    paths = []
    for index, value in enumerate(current):
        path = _artifact_path(value, f"{field}.mediaPaths[{index}]")
        if path is None:
            raise HTTPException(
                status_code=422, detail=f"{field}.mediaPaths[{index}] must be a path string"
            )
        paths.append(path)
    return paths


def _draft_source_paths(state: dict[str, Any]) -> list[str]:
    paths = []
    proof = _artifact_path(state.get("proofPng"), "state.proofPng")
    if proof:
        paths.append(proof)
    paths.extend(_media_paths(state, "state"))

    extra = state.get("extraTweets", [])
    if not isinstance(extra, list):
        raise HTTPException(status_code=422, detail="state.extraTweets must be an array")
    if len(extra) > MAX_EXTRA_POSTS:
        raise HTTPException(
            status_code=422,
            detail=f"state.extraTweets allows at most {MAX_EXTRA_POSTS} posts",
        )
    for index, tweet in enumerate(extra):
        if not isinstance(tweet, dict):
            raise HTTPException(
                status_code=422, detail=f"state.extraTweets[{index}] must be an object"
            )
        paths.extend(_media_paths(tweet, f"state.extraTweets[{index}]"))

    unique = list(dict.fromkeys(paths))
    if len(unique) > MAX_DRAFT_ATTACHMENTS:
        raise HTTPException(status_code=422, detail="draft has too many attachment paths")
    return unique


@router.get("/cases/{case_id}/drafts")
def list_drafts(case_id: str) -> list[dict[str, Any]]:
    case = get_case(case_id)
    drafts = []
    for path in sorted(case.subdir("exports").glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if data.get("azimut_draft") != DRAFT_MARKER:
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
    source_paths = _draft_source_paths(body.state)

    path = exports_dir / f"{name}.json"
    existing_created = None
    if path.exists():
        try:
            existing_created = json.loads(path.read_text(encoding="utf-8")).get("created_at")
        except (OSError, json.JSONDecodeError):
            existing_created = None

    data = {
        "azimut_draft": DRAFT_MARKER,
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
        entity_id = existing["id"]
    else:
        entity_id = case.add_entity(
            "post",
            body.title,
            attrs={"draft": f"exports/{name}.json"},
            by="post-composer",
        )["id"]

    # A post is derived from the proof it announces and the media it attaches —
    # it carries their coordinates and source in its own text, so it outlives
    # them (ONTOLOGY §3) and only loses its attachment.
    link_engine.sync(
        case,
        entity_id,
        link_engine.DERIVED_FROM,
        source_paths,
        by="post-composer",
    )

    return {"name": name, "draft": f"exports/{name}.json"}


@router.delete("/cases/{case_id}/drafts/{name}")
def delete_draft(case_id: str, name: str) -> dict[str, Any]:
    case = get_case(case_id)
    try:
        path = case.resolve_inside(f"exports/{name}.json")
    except CaseError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    result = delete_by_path(case, f"exports/{name}.json")
    if not result["deleted"]:  # never filed as an entity: drop the file anyway
        path.unlink(missing_ok=True)
    return result
