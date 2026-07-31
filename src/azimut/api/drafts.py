"""REST API for post drafts: save, list, load, delete.

A draft is the re-editable state of the Post Composer (thread of tweets built
from a geolocation). Drafts live in ``<case>/exports/`` as JSON and are indexed
as ``post`` entities so they show up in the case sidebar (spec §4 — the case is
the product). Azimut never posts on your behalf; a draft is prepared here and the
human publishes it (spec §6 non-goals).
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import PurePosixPath, PureWindowsPath
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..engine import artifacts as artifact_engine
from ..engine import links as link_engine
from ..workspace import CaseError
from .cases import delete_by_path, get_case
from .naming import read_created_at, slugify
from .. import layout

router = APIRouter(prefix="/api", tags=["drafts"])

DRAFT_MARKER = 1
MAX_MEDIA_PER_POST = 4
MAX_EXTRA_POSTS = 20
MAX_DRAFT_ATTACHMENTS = 1 + MAX_MEDIA_PER_POST * (1 + MAX_EXTRA_POSTS)
MAX_ARTIFACT_PATH_LENGTH = 512


class DraftIn(BaseModel):
    # The filename always follows the title, so renaming a saved draft moves its
    # file. ``rename_from`` is the stem the composer is currently bound to
    # (absent on a first save); a save that lands elsewhere renames that file in
    # place instead of leaving a copy behind under the old name.
    rename_from: str | None = None
    title: str = Field(min_length=1, max_length=200)
    state: dict[str, Any]  # opaque Post Composer state (fields + tweets)


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
    for path in sorted(case.subdir(layout.DRAFTS_DIR).glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if data.get("azimut_draft") != DRAFT_MARKER:
            continue
        state = data.get("state")
        drafts.append(
            {
                "name": path.stem,
                "title": data.get("title", path.stem),
                "updated_at": data.get("updated_at"),
                "created_at": data.get("created_at"),
                # The Saved map popup uses this small listing to identify the
                # destination without loading every full draft state.
                "target": state.get("target") if isinstance(state, dict) else None,
            }
        )
    drafts.sort(key=lambda d: d.get("updated_at") or "", reverse=True)
    return drafts


@router.get("/cases/{case_id}/drafts/{name}")
def load_draft(case_id: str, name: str) -> dict[str, Any]:
    case = get_case(case_id)
    try:
        path = case.resolve_inside(layout.draft_rel(name))
    except CaseError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if not path.exists():
        raise HTTPException(status_code=404, detail="draft not found")
    return json.loads(path.read_text(encoding="utf-8"))


@router.post("/cases/{case_id}/drafts")
def save_draft(case_id: str, body: DraftIn) -> dict[str, Any]:
    case = get_case(case_id)
    name = slugify(body.title, "Post")
    case.subdir(layout.DRAFTS_DIR)  # born on first save, so the folder exists
    source_paths = _draft_source_paths(body.state)
    rel = layout.draft_rel(name)
    path = case.resolve_inside(rel)

    # A rename lands on a free name or not at all: taking a name another draft
    # holds would leave two entities pointing at one file, and there is no sane
    # merge of the two. The first save of an unbound composer still writes over
    # a same-named draft — there the analyst is updating that one.
    old = slugify(body.rename_from, "draft") if body.rename_from else None
    old_rel = layout.draft_rel(old) if old and old != name else None
    if old_rel and path.exists():
        raise HTTPException(status_code=409, detail="another draft already uses that name")

    data = {
        "azimut_draft": DRAFT_MARKER,
        "title": name,
        "created_at": read_created_at(case.resolve_inside(layout.draft_rel(old or name))) or _now(),
        "updated_at": _now(),
        "state": body.state,
    }
    path.write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    # upsert the post entity (analyst action → confirmed). A rename rebinds the
    # entity the old name held rather than filing a second one, so the draft
    # keeps its folder, notes and links.
    existing = case.find_entity(attr="draft", value=old_rel or rel)
    if existing:
        patch: dict[str, Any] = {"label": name}
        if old_rel:
            patch["attrs"] = {"draft": rel}
        case.update_entity(existing["id"], patch)
        entity_id = existing["id"]
    else:
        entity_id = case.add_entity(
            "post",
            name,
            attrs={"draft": rel},
            by="post-composer",
        )["id"]
    if old_rel:
        case.resolve_inside(layout.draft_rel(str(old))).unlink(missing_ok=True)

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

    return {"name": name, "title": name, "draft": rel}


@router.delete("/cases/{case_id}/drafts/{name}")
def delete_draft(case_id: str, name: str) -> dict[str, Any]:
    case = get_case(case_id)
    rel = layout.draft_rel(name)
    try:
        case.resolve_inside(rel)
    except CaseError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    result = delete_by_path(case, rel)
    if not result["deleted"]:  # never filed as an entity: drop the file anyway
        artifact_engine.delete(case, {"type": "post", "attrs": {"draft": rel}})
    return result
