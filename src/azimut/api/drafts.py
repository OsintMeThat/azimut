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
from pydantic import BaseModel, Field, StrictBool

from ..engine import artifacts as artifact_engine
from ..engine import geo as geo_engine
from ..engine import links as link_engine
from ..engine import media as media_engine
from ..engine import renames as rename_engine
from ..workspace import CaseError
from .cases import delete_by_path, get_case
from .naming import existing_stem, holders, read_created_at, slugify, technical_name
from .. import layout

router = APIRouter(prefix="/api", tags=["drafts"])

DRAFT_MARKER = 1
MAX_MEDIA_PER_POST = 4
MAX_EXTRA_POSTS = 20
# the proof, a video thread's video, sheet, map and clip, then the first post's own
# pictures, the media post and the later ones
MAX_DRAFT_ATTACHMENTS = 1 + 4 + MAX_MEDIA_PER_POST * (2 + MAX_EXTRA_POSTS)
MAX_ARTIFACT_PATH_LENGTH = 512
#: What a post is made from (frontend `lib/post.js` POST_KINDS). A draft that says
#: nothing is a Geolocation one, as every draft was before kinds.
POST_KINDS = ("geolocation", "video", "plate", "compare", "free")

#: Whether a post went out, as its draft's ``state.publish`` says (frontend
#: `lib/post.js` ``postState``): once the analyst marked it posted, where and when, and
#: its link when they gave one. A draft that says nothing is a draft. ``opened_at`` is
#: what an earlier build wrote when it opened the site: still taken, so a tab running it
#: saves, and read as nothing.
PUBLISH_KEYS = frozenset({"opened_at", "site", "url", "posted_at", "mark", "changed"})
PUBLISH_SITES = ("x", "bluesky")
#: A post's own address, as the composer writes it once it went out (`postedAddress`).
POSTED_URL = {
    "x": re.compile(r"^https://x\.com/[A-Za-z0-9_]{1,15}/status/\d{1,25}$"),
    "bluesky": re.compile(r"^https://bsky\.app/profile/[^/?#\s]{1,253}/post/[A-Za-z0-9]{1,64}$"),
}
#: How many posts a proof keeps a record of, the latest last.
MAX_POSTED_PER_PROOF = 20
#: The longest description a picture keeps (frontend `lib/postAlt.js` ALT_MAX):
#: Bluesky's, the larger of the two sites' limits.
MAX_ALT_TEXT = 2000


class PublishIn(BaseModel):
    """A post marked posted from outside its composer, a card on Post's home or a link
    the extension caught for it: posted with this link or none, or not posted after all."""

    posted: StrictBool
    url: str | None = Field(default=None, max_length=300)


class DraftIn(BaseModel):
    # The filename always follows the title, so renaming a saved draft moves its
    # file. ``rename_from`` is the stem the composer is currently bound to
    # (absent on a first save); a save that lands elsewhere renames that file in
    # place instead of leaving a copy behind under the old name. An empty title is
    # no name: the draft files under a technical one, "Post 3" (`technical_name`),
    # which is how a name is cleared.
    rename_from: str | None = None
    title: str = Field(default="", max_length=200)
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
    # A video thread is made from its video, and names the contact sheet, the recap map
    # and the clip it made or picked for it, posted or not in the order it is in. Another
    # kind's draft never had these, and what it holds under them is not read.
    if state.get("kind") == "video":
        for key in ("video", "sheet", "map", "clip"):
            named = _artifact_path(state.get(key), f"state.{key}")
            if named:
                paths.append(named)
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


def _alt_texts(state: dict[str, Any]) -> None:
    """The pictures' descriptions a post keeps (``alt``, frontend `lib/postAlt.js`): a case
    path to its text, written only while the composer's Alt text box is on and a text
    is typed. Refused at the edge unless it is that: bounded paths and bounded strings."""
    alt = state.get("alt")
    if alt is None:
        return
    if not isinstance(alt, dict) or len(alt) > MAX_DRAFT_ATTACHMENTS:
        raise HTTPException(status_code=422, detail="state.alt must map pictures to their descriptions")
    for path, text in alt.items():
        _artifact_path(path, "state.alt")
        if not isinstance(text, str) or len(text) > MAX_ALT_TEXT:
            raise HTTPException(
                status_code=422, detail=f"state.alt texts must be at most {MAX_ALT_TEXT} characters"
            )


def _link_site(url: Any) -> str | None:
    """The site an X or Bluesky post's address is on, or None for anything else."""
    if not isinstance(url, str):
        return None
    return next((name for name, rule in POSTED_URL.items() if rule.match(url)), None)


def _posted(state: dict[str, Any]) -> dict[str, Any] | None:
    """Where and when the post went out, or None: read off a record already on disk, so
    one that does not pass is no post rather than an error. A post is out once it has its
    link, or once it was marked posted without one (``posted_at``); its site is its link's,
    else the one it was marked on, else its draft's platform."""
    publish = state.get("publish")
    if not isinstance(publish, dict):
        return None
    url = publish.get("url")
    linked = _link_site(url)
    at = publish.get("posted_at")
    at = at if isinstance(at, str) and at else None
    if url is not None and not linked:
        return None
    if not linked and not at:
        return None
    site = linked or next(
        (one for one in (publish.get("site"), state.get("target")) if one in PUBLISH_SITES), "x"
    )
    return {"url": url if linked else None, "site": site, "at": at}


def _post_state(state: dict[str, Any]) -> str:
    """``draft``, ``posted``, or ``changed`` (edited since it went out), as `lib/post.js`
    ``postState`` reads the same record."""
    publish = state.get("publish")
    if _posted(state):
        return "changed" if isinstance(publish, dict) and publish.get("changed") is True else "posted"
    return "draft"


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


def _proof_entry(posted: dict[str, Any]) -> dict[str, Any]:
    """A post as its proof keeps it: its site and date, and its link when it has one."""
    return {key: value for key, value in posted.items() if value is not None}


def _proof_posts(
    case: Any, png: str, *, drop: dict[str, Any] | None = None, add: dict[str, Any] | None = None
) -> None:
    """Keep the proof's ``posted`` record in step with the post about it: the link the
    post went out at when it has one, its site and its date. It is a record of the post,
    not a source of the proof, so it lives on the proof's entity rather than in its
    sources. An entry is the post's own: the one it held is dropped, and so is any other
    naming the link it now has."""
    entity = case.find_entity(attr="path", value=png)
    if not entity or entity.get("type") != "proof":
        return
    held = entity.get("attrs", {}).get("posted")
    links = {one.get("url") for one in (drop, add) if one and one.get("url")}

    def kept(one: Any) -> bool:
        if not isinstance(one, dict):
            return False
        if drop and one == _proof_entry(drop):
            return False
        return not (one.get("url") and one.get("url") in links)

    posts = [one for one in (held if isinstance(held, list) else []) if kept(one)]
    if add:
        posts.append(_proof_entry(add))
    posts = posts[-MAX_POSTED_PER_PROOF:]
    if posts != held:
        case.update_entity(entity["id"], {"attrs": {"posted": posts or None}})


def _said(value: Any) -> str | None:
    """A field's words, or None for nothing said."""
    return value.strip() if isinstance(value, str) and value.strip() else None


def _first_point(text: Any) -> list[float] | None:
    """The post's first coordinates, ``[lat, lon]``, from its coordinates field: the
    point its place and its plus code are about. A name before them is left aside."""
    if not isinstance(text, str):
        return None
    line = next((one.strip() for one in text.splitlines() if one.strip()), "")
    found = geo_engine.parse_coords(line.split(" — ", 1)[-1]) if line else None
    return [round(found[0], 6), round(found[1], 6)] if found else None


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
                "posted": _posted(state),
                "picture": _picture(state),
                # What a post with no name of its own is labelled by (frontend
                # `postHome.postLabel`): its place, its date and its point, as it says them.
                "place": _said(state.get("place")),
                "when": _said(state.get("date")),
                "coords": _first_point(state.get("coordsText")),
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
    folder = case.subdir(layout.DRAFTS_DIR)  # born on first save, so the folder exists
    bound = existing_stem(body.rename_from, "draft") if body.rename_from else None
    name = slugify(body.title, "Post") if body.title.strip() else technical_name(folder, "draft", bound)
    source_paths = _draft_source_paths(body.state)
    _publish(body.state)
    _alt_texts(body.state)
    rel = layout.draft_rel(name)
    path = case.resolve_inside(rel)

    # A rename lands on a free name or not at all: taking a name another draft
    # holds would leave two entities pointing at one file, and there is no sane
    # merge of the two. The first save of an unbound composer still writes over
    # a same-named draft — there the analyst is updating that one.
    # Taken is judged without case, the draft being saved excepted: two names that
    # differ only by case are one file on Windows and macOS.
    old = bound
    old_rel = layout.draft_rel(old) if old and old != name else None
    if holders(path.parent, name, source=old if old_rel else name):
        raise HTTPException(status_code=409, detail="another draft already uses that name")
    # A rename lands first, on its own, a change of case included: the draft moves to
    # its new name with its entity, so it keeps its folder, notes and links, and
    # whatever names it follows (`engine/renames.py`). The save then writes onto the
    # new name like any other.
    if old_rel and case.resolve_inside(old_rel).is_file():
        rename_engine.rename_record(case, "post", old_rel, rel)
        path = case.resolve_inside(rel)

    # What the post said of its going out before this save, so the proof it is about
    # follows a link pasted, changed or taken back.
    try:
        before = json.loads(path.read_text(encoding="utf-8")).get("state")
    except (OSError, json.JSONDecodeError, AttributeError):
        before = None
    before = before if isinstance(before, dict) else {}

    data = {
        "azimut_draft": DRAFT_MARKER,
        "title": name,
        "created_at": read_created_at(path) or _now(),
        "updated_at": _now(),
        "state": body.state,
    }
    media_engine.write_json_atomic(path, data)

    # upsert the post entity (analyst action → confirmed)
    existing = case.find_entity(attr="draft", value=rel)
    if existing:
        case.update_entity(existing["id"], {"label": name})
        entity_id = existing["id"]
    else:
        entity_id = case.add_entity(
            "post",
            name,
            attrs={"draft": rel},
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

    _follow_posted(case, before, body.state)
    return {"name": name, "title": name, "draft": rel}


@router.put("/cases/{case_id}/drafts/{name}/publish")
def mark_draft_posted(case_id: str, name: str, body: PublishIn) -> dict[str, Any]:
    """Mark a saved post posted, or not, without opening it: only its ``publish`` record
    and the proof it is about change. A post already out keeps its date and its print and
    takes the link given, or loses the one it had; one not out yet is posted now, its
    print left for the composer to take when it next opens it."""
    case = get_case(case_id)
    try:
        path = case.resolve_inside(layout.draft_rel(name))
    except CaseError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if not path.is_file():
        raise HTTPException(status_code=404, detail="draft not found")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=422, detail="draft could not be read") from exc
    if not isinstance(data, dict) or data.get("azimut_draft") != DRAFT_MARKER:
        raise HTTPException(status_code=422, detail="not a post draft")
    held_state = data.get("state")
    before: dict[str, Any] = held_state if isinstance(held_state, dict) else {}
    state = dict(before)
    linked = _link_site(body.url) if body.url is not None else None
    if body.url is not None and not linked:
        raise HTTPException(status_code=422, detail="url must be the address of an X or Bluesky post")

    if not body.posted:
        state.pop("publish", None)
    else:
        out = _posted(before)
        was = before.get("publish")
        held: dict[str, Any] = was if out and isinstance(was, dict) else {}
        record: dict[str, Any] = {key: held[key] for key in ("posted_at", "mark", "changed") if key in held}
        record.setdefault("posted_at", _now())
        record.setdefault("changed", False)
        target = state.get("target")
        record["site"] = linked or (out["site"] if out else None) or (
            target if target in PUBLISH_SITES else "x"
        )
        if body.url is not None:
            record["url"] = body.url
        state["publish"] = record
    _publish(state)

    data["state"] = state
    data["updated_at"] = _now()
    media_engine.write_json_atomic(path, data)
    _follow_posted(case, before, state)
    return {"name": path.stem, "state": _post_state(state), "posted": _posted(state)}


def _follow_posted(case: Any, before: dict[str, Any], after: dict[str, Any]) -> None:
    """Write the post's link on the proof it is about, and take back the one it replaced."""
    def record(state: dict[str, Any]) -> tuple[str, dict[str, Any]] | None:
        posted = _posted(state)
        proof = state.get("proofPng")
        return (proof, posted) if posted and isinstance(proof, str) else None

    old, new = record(before), record(after)
    if old == new:
        return
    if old and (not new or old[0] != new[0]):
        _proof_posts(case, old[0], drop=old[1])
    if new:
        _proof_posts(case, new[0], drop=old[1] if old and old[0] == new[0] else None, add=new[1])


def draft_spec(name: str) -> str:
    """The record a draft's name stands for, as its delete and its preview read it."""
    return layout.draft_rel(existing_stem(name, "draft"))


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
