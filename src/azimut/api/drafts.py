"""REST API for post drafts: save, list, load, delete.

A draft is the re-editable state of the Post Composer (thread of tweets built
from a geolocation). Drafts live in ``<case>/.drafts/`` as JSON and are indexed
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

from ..engine import artifacts as artifact_engine
from ..engine import links as link_engine
from ..engine import media as media_engine
from ..workspace import CaseError
from .cases import delete_by_path, get_case
from .naming import case_only, holders, read_created_at, slugify
from .. import layout

router = APIRouter(prefix="/api", tags=["drafts"])

DRAFT_MARKER = 1
MAX_MEDIA_PER_POST = 4
MAX_EXTRA_POSTS = 20
# the proof, or the first post's own pictures, then the media post and the later ones
MAX_DRAFT_ATTACHMENTS = 1 + MAX_MEDIA_PER_POST * (2 + MAX_EXTRA_POSTS)
MAX_ARTIFACT_PATH_LENGTH = 512
#: What a post is made from (frontend `lib/post.js` POST_KINDS). A draft that says
#: nothing is a Geolocation one, as every draft was before kinds.
POST_KINDS = ("geolocation", "video", "plate", "free")

#: Whether a post went out, as its draft's ``state.publish`` says (frontend
#: `lib/post.js` ``postState``): when the composer opened the site, and once the analyst
#: pasted its link, where it was posted and when. A draft that says nothing is a draft.
PUBLISH_KEYS = frozenset({"opened_at", "site", "url", "posted_at", "mark", "changed"})
PUBLISH_SITES = ("x", "bluesky")
#: A post's own address, as the composer writes it once it went out (`postedAddress`).
POSTED_URL = {
    "x": re.compile(r"^https://x\.com/[A-Za-z0-9_]{1,15}/status/\d{1,25}$"),
    "bluesky": re.compile(r"^https://bsky\.app/profile/[^/?#\s]{1,253}/post/[A-Za-z0-9]{1,64}$"),
}
#: How many posts a proof keeps a record of, the latest last.
MAX_POSTED_PER_PROOF = 20


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


def _media_paths(state: dict[str, Any], field: str, key: str = "mediaPaths") -> list[str]:
    current = state.get(key)
    if current is None and key == "mediaPaths":
        current = [] if state.get("mediaPath") is None else [state.get("mediaPath")]
    if current is None:
        current = []
    if not isinstance(current, list):
        raise HTTPException(status_code=422, detail=f"{field}.{key} must be an array")
    if len(current) > MAX_MEDIA_PER_POST:
        raise HTTPException(
            status_code=422,
            detail=f"{field}.{key} allows at most {MAX_MEDIA_PER_POST} paths",
        )
    paths = []
    for index, value in enumerate(current):
        path = _artifact_path(value, f"{field}.{key}[{index}]")
        if path is None:
            raise HTTPException(
                status_code=422, detail=f"{field}.{key}[{index}] must be a path string"
            )
        paths.append(path)
    return paths


def _draft_source_paths(state: dict[str, Any]) -> list[str]:
    paths = []
    proof = _artifact_path(state.get("proofPng"), "state.proofPng")
    if proof:
        paths.append(proof)
    # The pictures on the first post of a post that is not a geolocation, where the
    # proof would be on one that is.
    paths.extend(_media_paths(state, "state", "firstMedia"))
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


def _publish(state: dict[str, Any]) -> dict[str, Any] | None:
    """The draft's ``publish`` record, refused at the edge unless it is what the composer
    writes: bounded strings, a known site, and a link that is an X or Bluesky post."""
    publish = state.get("publish")
    if publish is None:
        return None
    if not isinstance(publish, dict) or not set(publish) <= PUBLISH_KEYS:
        raise HTTPException(status_code=422, detail="state.publish must be a publishing record")
    for key in ("opened_at", "posted_at", "mark"):
        value = publish.get(key)
        if value is not None and (not isinstance(value, str) or len(value) > 64):
            raise HTTPException(status_code=422, detail=f"state.publish.{key} must be a short string")
    site = publish.get("site")
    if site is not None and site not in PUBLISH_SITES:
        raise HTTPException(status_code=422, detail="state.publish.site must be x or bluesky")
    url = publish.get("url")
    if url is not None and not (
        isinstance(url, str) and any(rule.match(url) for rule in POSTED_URL.values())
    ):
        raise HTTPException(
            status_code=422, detail="state.publish.url must be the address of an X or Bluesky post"
        )
    if publish.get("changed") is not None and not isinstance(publish.get("changed"), bool):
        raise HTTPException(status_code=422, detail="state.publish.changed must be true or false")
    return publish


def _posted(state: dict[str, Any]) -> dict[str, Any] | None:
    """Where and when the post went out, or None: read off a record already on disk, so
    one that does not pass is no post rather than an error."""
    publish = state.get("publish")
    if not isinstance(publish, dict):
        return None
    url = publish.get("url")
    if not isinstance(url, str):
        return None
    site = next((name for name, rule in POSTED_URL.items() if rule.match(url)), None)
    if site is None:
        return None
    at = publish.get("posted_at")
    return {"url": url, "site": site, "at": at if isinstance(at, str) else None}


def _post_state(state: dict[str, Any]) -> str:
    """``draft``, ``opened`` (the site opened with it), ``posted``, or ``changed`` (edited
    since it went out), as `lib/post.js` ``postState`` reads the same record."""
    publish = state.get("publish")
    if _posted(state):
        return "changed" if isinstance(publish, dict) and publish.get("changed") is True else "posted"
    if isinstance(publish, dict) and isinstance(publish.get("opened_at"), str):
        return "opened"
    return "draft"


def _site(state: dict[str, Any]) -> str | None:
    """The site the post was opened on or went out on, when it says."""
    posted = _posted(state)
    if posted:
        return str(posted["site"])
    publish = state.get("publish")
    site = publish.get("site") if isinstance(publish, dict) else None
    return site if site in PUBLISH_SITES else None


def _picture(state: dict[str, Any]) -> str | None:
    """The case file a card shows for the draft: its proof, else the first file it carries.
    Named off the state already read; the card finds its thumbnail in the lists it has."""
    if isinstance(state.get("proofPng"), str):
        return str(state["proofPng"])
    for key in ("firstMedia", "mediaPaths"):
        paths = state.get(key)
        if isinstance(paths, list) and paths and isinstance(paths[0], str):
            return str(paths[0])
    return None


def _proof_posts(case: Any, png: str, *, drop: str | None = None, add: dict[str, Any] | None = None) -> None:
    """Keep the proof's ``posted`` record in step with the post about it: the link the
    post went out at, its site and its date. It is a record of the post, not a source of
    the proof, so it lives on the proof's entity rather than in its sources."""
    entity = case.find_entity(attr="path", value=png)
    if not entity or entity.get("type") != "proof":
        return
    held = entity.get("attrs", {}).get("posted")
    posts = [
        one for one in (held if isinstance(held, list) else [])
        if isinstance(one, dict) and one.get("url") not in {drop, (add or {}).get("url")}
    ]
    if add:
        posts.append(add)
    posts = posts[-MAX_POSTED_PER_PROOF:]
    if posts != held:
        case.update_entity(entity["id"], {"attrs": {"posted": posts or None}})


def _post_count(state: dict[str, Any]) -> int:
    """How many posts a draft's thread holds, as the composer copies it: the first one,
    the media post when it is on and chosen, and each later post that says or carries
    something."""
    def said(value: Any) -> bool:
        return isinstance(value, str) and bool(value.strip())

    def carried(post: dict[str, Any]) -> bool:
        paths = post.get("mediaPaths")
        return isinstance(paths, list) and bool(paths)

    count = 1
    if state.get("mediaEnabled", True) is not False and state.get("mediaType", "none") != "none":
        count += 1
    extra = state.get("extraTweets")
    for post in extra if isinstance(extra, list) else []:
        if isinstance(post, dict) and (said(post.get("text")) or carried(post)):
            count += 1
    return count


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
        state = state if isinstance(state, dict) else {}
        drafts.append(
            {
                "name": path.stem,
                "title": data.get("title", path.stem),
                "updated_at": data.get("updated_at"),
                "created_at": data.get("created_at"),
                # The Saved map popup uses this small listing to identify the
                # destination without loading every full draft state.
                "target": state.get("target"),
                # What Post's home says of each draft without opening it: its kind,
                # how many posts it holds, and the proof or the video it posts, which
                # is also how the home knows what has a post already.
                "kind": state.get("kind") if state.get("kind") in POST_KINDS else "geolocation",
                "posts": _post_count(state),
                "proof": state.get("proofPng") if isinstance(state.get("proofPng"), str) else None,
                "video": state.get("video") if isinstance(state.get("video"), str) else None,
                # Whether it went out, and where, for the home's parts and the Open list;
                # and the file its card shows. All read off the state already open.
                "state": _post_state(state),
                "site": _site(state),
                "posted": _posted(state),
                "picture": _picture(state),
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
    _publish(body.state)
    rel = layout.draft_rel(name)
    path = case.resolve_inside(rel)

    # A rename lands on a free name or not at all: taking a name another draft
    # holds would leave two entities pointing at one file, and there is no sane
    # merge of the two. The first save of an unbound composer still writes over
    # a same-named draft — there the analyst is updating that one.
    # Taken is judged without case, the draft being saved excepted: two names that
    # differ only by case are one file on Windows and macOS.
    old = slugify(body.rename_from, "draft") if body.rename_from else None
    old_rel = layout.draft_rel(old) if old and old != name else None
    if holders(path.parent, name, source=old if old_rel else name):
        raise HTTPException(status_code=409, detail="another draft already uses that name")
    recased = case_only(old, name)
    if recased and old:
        # One file under both names there: renamed in place, never deleted as "the old one".
        source = case.resolve_inside(layout.draft_rel(old))
        # The name asked for, not `path`'s: Windows resolves a path to the case
        # already on disk.
        if source.is_file():
            path = source.with_name(PurePosixPath(rel).name)
            media_engine.rename_path(source, path)

    # What the post said of its going out before this save, so the proof it is about
    # follows a link pasted, changed or taken back.
    before_path = case.resolve_inside(layout.draft_rel(old or name))
    try:
        before = json.loads(before_path.read_text(encoding="utf-8")).get("state")
    except (OSError, json.JSONDecodeError, AttributeError):
        before = None
    before = before if isinstance(before, dict) else {}

    data = {
        "azimut_draft": DRAFT_MARKER,
        "title": name,
        "created_at": read_created_at(
            path if recased else case.resolve_inside(layout.draft_rel(old or name))
        ) or _now(),
        "updated_at": _now(),
        "state": body.state,
    }
    media_engine.write_json_atomic(path, data)

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
    if old_rel and not recased:
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

    _follow_posted(case, before, body.state)
    return {"name": name, "title": name, "draft": rel}


def _follow_posted(case: Any, before: dict[str, Any], after: dict[str, Any]) -> None:
    """Write the post's link on the proof it is about, and take back the one it replaced."""
    def record(state: dict[str, Any]) -> tuple[str, dict[str, Any]] | None:
        posted = _posted(state)
        proof = state.get("proofPng")
        return (proof, posted) if posted and isinstance(proof, str) else None

    old, new = record(before), record(after)
    if old == new:
        return
    if old and (not new or old[0] != new[0] or old[1]["url"] != new[1]["url"]):
        _proof_posts(case, old[0], drop=old[1]["url"])
    if new:
        _proof_posts(case, new[0], add=new[1])


def draft_spec(name: str) -> str:
    """The record a draft's name stands for, as its delete and its preview read it."""
    return layout.draft_rel(slugify(name, "draft"))


@router.delete("/cases/{case_id}/drafts/{name}")
def delete_draft(case_id: str, name: str) -> dict[str, Any]:
    case = get_case(case_id)
    # Named the way the save named it — see `api/satellite.delete_search_grid`.
    rel = draft_spec(name)
    try:
        case.resolve_inside(rel)
    except CaseError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    result = delete_by_path(case, rel)
    if not result["deleted"]:  # never filed as an entity: drop the file anyway
        artifact_engine.delete(case, {"type": "post", "attrs": {"draft": rel}})
    return result
