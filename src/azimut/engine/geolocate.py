"""Geolocating a scene: the one the analyst is looking for on the map, and the captures it gathers.

A scene still to prove (a draft in its video's Inspect work, `engine/scenes.py`) reads
**To geolocate** until a capture is attached to it, **In progress** while it holds one,
and **Abandoned** once the analyst gives up on it, with a word if they like. A proof
citing it makes it **Proved**, and from then on the proof is what the case shows. In
progress asserts nothing: a capture is where somebody looked, not where the place is.

**The scene being geolocated belongs to the session.** It is held here in memory, one
per case, and never saved: a restart ends it, as it ends the reference window it came
with. While it lasts, every capture filed in the case is attached to it on the server
(`attach`), from the app's map tools or from the extension over Google Maps, so no
client has to remember which scene it is working for. It ends when the analyst says
so, when a proof takes the scene up, when the scene is abandoned, and when the scene
is no longer there to attach to.

What a scene gathers is written by `inspectwork.update_scene` alone. Inspect saves its
scenes whole and never sends ``captures`` or ``abandoned``, and a save keeps them
(`inspectwork.SCENE_STATE`).
"""

from __future__ import annotations

import json
import math
import threading
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

from .. import layout
from ..workspace import CaseError
from . import inspectwork
from . import scenes as scenes_engine
from .scenes import draft_row as scene_row

if TYPE_CHECKING:
    from ..workspace import Case

#: Captures one scene keeps. Past it the oldest stay and the newest are not attached.
MAX_CAPTURES = 100
MAX_REASON = 200

_lock = threading.Lock()
# case id -> {"video": path, "draft": scene id, "since": iso time}
_active: dict[str, dict[str, str]] = {}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _taken(specs: list[tuple[str, dict[str, Any]]]) -> set[str]:
    """The drafts a proof in the case takes up: those are Proved, and no longer here."""
    taken: set[str] = set()
    for _name, spec in specs:
        taken |= scenes_engine.cited_drafts(scenes_engine.stated_scene(spec))
    return taken


def _kinds(case: Case, paths: list[str]) -> dict[str, str]:
    """Each file's kind, `video` or `image`, as the media index holds it."""
    return {item["path"]: str(item.get("kind") or "") for item in case.media_items_by_paths(paths) if item.get("path")}


def _proved(specs: list[tuple[str, dict[str, Any]]], taken: set[str], path: str, draft_id: str, kind: str) -> bool:
    """A scene of a video leaves the queue once a proof cites it, the proof standing in
    its place there until it states a place (`scenes.unplaced_proofs`); a picture marked
    to geolocate, once a proof that states a place lays it out."""
    if kind == "image":
        return any(scenes_engine.states_place(spec) for _name, spec in scenes_engine.laid_out_by(specs, path))
    return draft_id in taken


def _orders(case: Case, videos: list[str], proofs: Any = None) -> dict[tuple[str, str], int]:
    """Each draft's place among its video's scenes, proofs included, in clip order:
    what Inspect colours a scene by (`lib/scenes.js`, sceneList), so the queue, the
    pill and the reference window draw it in the same colour. A file that is not a
    video has no bar, and its scenes no place."""
    proofs = proofs if proofs is not None else scenes_engine.read_proofs(case)
    # every work read once, and the order taken from the times alone
    return scenes_engine.scene_places(case, videos, proofs, inspectwork.subject_specs(case))


def _placed(row: dict[str, Any], places: dict[tuple[str, str], int]) -> dict[str, Any]:
    return {**row, "order": places.get((row["video"], row["id"]), 0)}


def _draft(case: Case, video: str, draft_id: str) -> dict[str, Any] | None:
    work = inspectwork.find_work(case, video)
    for scene in ((work or {}).get("spec") or {}).get("scenes") or []:
        if isinstance(scene, dict) and scene.get("id") == draft_id:
            return scene
    return None


def _in_case(case: Case, path: str) -> dict[str, Any] | None:
    entity = case.find_entity(attr="path", value=path)
    return entity if entity is not None and entity.get("type") in ("media", "capture") else None


def _collage_of(case: Case, item: dict[str, Any]) -> str | None:
    """The collage that exported this picture, by the name its entity keeps."""
    source = item.get("source")
    if not isinstance(source, dict) or source.get("op") != scenes_engine.COLLAGE_OP:
        return None
    entity_id = item.get("entity_id")
    entity = case.get_entity(entity_id) if isinstance(entity_id, str) and entity_id else None
    name = ((entity or {}).get("attrs") or {}).get("collage")
    return name if isinstance(name, str) and name else None


def _present(case: Case, paths: list[str]) -> dict[str, dict[str, Any]]:
    """The files still in the case, by path, from the media index: one query, where a
    lookup per file scans every entity of a large case."""
    unique = list(dict.fromkeys(p for p in paths if p))
    found: dict[str, dict[str, Any]] = {}
    for at in range(0, len(unique), 500):
        for item in case.media_items_by_paths(unique[at : at + 500]):
            if item.get("path"):
                found[item["path"]] = item
    return found


# -- the scene being geolocated -------------------------------------------------------


def current(case: Case) -> dict[str, Any] | None:
    """The scene the case is geolocating, read afresh, or None.

    One that left meanwhile (deleted in Inspect, taken up by a proof, abandoned, its
    video sent to the Trash) ends here, so nothing is attached to a scene that is gone.
    """
    with _lock:
        held = dict(_active.get(case.id) or {})
    if not held:
        return None
    draft = _draft(case, held["video"], held["draft"]) if _present(case, [held["video"]]) else None
    proofs = scenes_engine.read_proofs(case)
    kind = _kinds(case, [held["video"]]).get(held["video"], "video")
    if draft is None or draft.get("abandoned") or _proved(proofs[0], _taken(proofs[0]), held["video"], draft["id"], kind):
        stop(case, held["draft"])
        return None
    row = _placed(scene_row(case, held["video"], draft, kind), _orders(case, [held["video"]], proofs))
    return {**row, "since": held["since"]}


def settle(case: Case) -> bool:
    """Read the scene being geolocated again after something that may have proved it,
    a proof laying its picture out: True when that ended it."""
    with _lock:
        if case.id not in _active:
            return False
    return current(case) is None


def start(case: Case, video: str, draft_id: str) -> dict[str, Any]:
    """Geolocate one scene to prove, in place of any other the case was geolocating."""
    if _in_case(case, video) is None:
        raise CaseError("that file is not in the case")
    draft = _draft(case, video, draft_id)
    if draft is None:
        raise CaseError("that scene is no longer in its file's work")
    proofs = scenes_engine.read_proofs(case)
    kind = _kinds(case, [video]).get(video, "video")
    if _proved(proofs[0], _taken(proofs[0]), video, draft_id, kind):
        raise CaseError("a proof already geolocates that scene")
    if draft.get("abandoned"):
        raise CaseError("that scene was abandoned: bring it back first")
    since = _now()
    with _lock:
        _active[case.id] = {"video": video, "draft": draft_id, "since": since}
    return {**_placed(scene_row(case, video, draft, kind), _orders(case, [video], proofs)), "since": since}


def stop(case: Case, draft_id: str | None = None) -> bool:
    """End the geolocating, or only when it is about ``draft_id``. True if it ended."""
    with _lock:
        held = _active.get(case.id)
        if held is None or (draft_id is not None and held["draft"] != draft_id):
            return False
        del _active[case.id]
    return True


def repath(case: Case, old: str, new: str, draft_ids: set[str]) -> bool:
    """Follow a scene being geolocated to the file its mark moved to. True if it did."""
    with _lock:
        held = _active.get(case.id)
        if held is None or held["video"] != old or held["draft"] not in draft_ids:
            return False
        held["video"] = new
    return True


def attach(case: Case, path: str) -> dict[str, Any] | None:
    """Attach a capture just filed to the scene being geolocated, if there is one, and
    answer with that scene (``video``, ``id``, ``label``) so the capture can say so."""
    with _lock:
        held = dict(_active.get(case.id) or {})
    if not held:
        return None

    def gather(scene: dict[str, Any]) -> None:
        held_paths = [p for p in scene.get("captures") or [] if isinstance(p, str)]
        if path not in held_paths and len(held_paths) < MAX_CAPTURES:
            held_paths.append(path)
        scene["captures"] = held_paths

    try:
        scene = inspectwork.update_scene(case, held["video"], held["draft"], gather)
    except CaseError:
        stop(case, held["draft"])
        return None
    gathered = scene.get("captures") or []
    return {
        "video": held["video"],
        "id": held["draft"],
        "label": str(scene.get("label") or ""),
        # how many the scene now holds, so the pills count it without asking again
        "captures": len(gathered),
    }


# -- the same place -------------------------------------------------------------------


def _follow(case: Case, video: str, was: str, now: str) -> bool:
    """Move the scene being geolocated from one draft of a video to another. True if it did."""
    with _lock:
        held = _active.get(case.id)
        if held is None or held["video"] != video or held["draft"] != was:
            return False
        held["draft"] = now
    return True


def join(case: Case, video: str, draft_id: str, into: str) -> dict[str, Any]:
    """Join a scene to prove to another of its video that shows the same place
    (`inspectwork.join_scenes`): one scene, its moments together. The scene being
    geolocated, if it was either, is the joined one. Answers with its row, what an
    Undo hands back (`unjoin`), and whether the scene being geolocated moved."""
    proofs = scenes_engine.read_proofs(case)
    if {draft_id, into} & _taken(proofs[0]):
        raise CaseError("a proof already geolocates that scene")
    done = inspectwork.join_scenes(case, video, draft_id, into, MAX_CAPTURES)
    moved = _follow(case, video, draft_id, into)
    kind = _kinds(case, [video]).get(video, "video")
    row = _placed(scene_row(case, video, done["scene"], kind), _orders(case, [video], proofs))
    return {
        "scene": row,
        "undo": {"kept": done["kept"], "gone": done["gone"], "geolocating": draft_id if moved else None},
        "moved": moved,
    }


def unjoin(case: Case, video: str, kept: Any, gone: Any, geolocating: Any = None) -> dict[str, Any]:
    """Put two joined scenes back as they were (`inspectwork.unjoin_scenes`), the one
    that was being geolocated geolocated again while the joined one still is. Answers
    with both rows and whether the scene being geolocated moved."""
    done = inspectwork.unjoin_scenes(case, video, kept, gone, MAX_CAPTURES)
    back = done["gone"]["id"]
    moved = geolocating == back and _follow(case, video, done["scene"]["id"], back)
    kind = _kinds(case, [video]).get(video, "video")
    places = _orders(case, [video])
    rows = [_placed(scene_row(case, video, one, kind), places) for one in (done["scene"], done["gone"])]
    return {"scenes": rows, "moved": moved}


# -- abandoning -----------------------------------------------------------------------


def abandon(case: Case, video: str, draft_id: str, reason: Any = "") -> dict[str, Any]:
    """Give up on a scene to prove, with a word if the analyst has one. It stays where
    it is, and `restore` brings it back as it was, captures and all."""
    if reason is not None and not isinstance(reason, str):
        raise CaseError("the reason is text")
    word = (reason or "").strip()[:MAX_REASON]

    def leave(scene: dict[str, Any]) -> None:
        scene["abandoned"] = {"reason": word, "at": _now()}

    scene = inspectwork.update_scene(case, video, draft_id, leave)
    stop(case, draft_id)
    return scene_row(case, video, scene, _kinds(case, [video]).get(video, "video"))


def restore(case: Case, video: str, draft_id: str) -> dict[str, Any]:
    """Take an abandoned scene up again."""
    scene = inspectwork.update_scene(case, video, draft_id, lambda one: one.pop("abandoned", None))
    return scene_row(case, video, scene, _kinds(case, [video]).get(video, "video"))


def _proof_entity(case: Case, name: str) -> dict[str, Any]:
    entity = case.find_entity(attr="spec", value=layout.proof_spec_rel(name))
    if entity is None or entity.get("type") != "proof":
        raise CaseError("no such proof in the case")
    return entity


def _proof_spec(case: Case, name: str) -> dict[str, Any]:
    try:
        spec = json.loads(case.resolve_inside(layout.proof_spec_rel(name)).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise CaseError("that proof cannot be read") from exc
    return spec if isinstance(spec, dict) else {}


def _proof_video(spec: dict[str, Any]) -> str | None:
    stated = scenes_engine.stated_scene(spec)
    return stated["video"] if stated else None


def abandon_proof(case: Case, name: str, reason: Any = "") -> dict[str, Any]:
    """Give up on a proof that states no place, as on a scene still to prove: it stays
    as it is, greyed among the abandoned, and `restore_proof` takes it up again. One
    that states a place is Proved, and refused."""
    if reason is not None and not isinstance(reason, str):
        raise CaseError("the reason is text")
    entity = _proof_entity(case, name)
    spec = _proof_spec(case, name)
    if scenes_engine.states_place(spec):
        raise CaseError("this proof states a place: it is proved")
    word = (reason or "").strip()[:MAX_REASON]
    abandoned = {"reason": word, "at": _now()}
    case.update_entity(entity["id"], {"attrs": {"abandoned": abandoned}})
    return {"proof": name, "video": _proof_video(spec), "state": scenes_engine.ABANDONED, "abandoned": abandoned}


def restore_proof(case: Case, name: str) -> dict[str, Any]:
    """Take an abandoned proof up again."""
    entity = _proof_entity(case, name)
    if (entity.get("attrs") or {}).get("abandoned") is not None:
        case.update_entity(entity["id"], {"attrs": {"abandoned": None}})
    return {"proof": name, "video": _proof_video(_proof_spec(case, name)), "state": scenes_engine.PROGRESS, "abandoned": None}


# -- marking a whole file -------------------------------------------------------------


def mark(case: Case, path: str, label: Any = "", start: Any = None, end: Any = None) -> dict[str, Any]:
    """Mark a picture or a video to geolocate from outside Inspect, and answer with its scene.

    A picture is marked whole. A video is marked whole, or over ``start``–``end`` (an
    instant without an end), the scene already there at that time if there is one. A
    video is one place or several: a time marked on one whose only live scene is still
    to prove and about the whole video goes to that scene (`whole_taker`), as Inspect's
    S does, and marking whole one that already holds passages is refused. A collage composed from one video's frames belongs to that video: marking it
    marks the video, over the same time. A frame Inspect cut belongs to its video's
    scenes and a capture is an answer, not a question: neither is marked.
    """
    if label is not None and not isinstance(label, str):
        raise CaseError("a scene label must be text")
    entity = case.find_entity(attr="path", value=path)
    if entity is None or entity.get("type") != "media":
        raise CaseError("only a file of the case's media is marked to geolocate")
    kind = _kinds(case, [path]).get(path)
    if kind not in ("image", "video"):
        raise CaseError("only a picture or a video is marked to geolocate")
    if kind == "image":
        origin = scenes_engine.frame_origins(case, [path]).get(path)
        if origin is not None:
            if not _composed(case, path):
                raise CaseError("a frame cut from a video belongs to its video's scenes")
            path, kind = origin[0], "video"
    at = scenes_engine._seconds(start) if start is not None else None
    until = scenes_engine._seconds(end) if end is not None and at is not None else None
    if start is not None and at is None:
        raise CaseError("a scene's start is a time in seconds")
    if kind == "image" and at is not None:
        raise CaseError("a picture is marked whole")
    if until is not None and at is not None and until <= at:
        raise CaseError("a scene must end after it starts")
    word = (label or "").strip()[: inspectwork.MAX_SCENE_LABEL]

    # the scene holding that one moment: one holding further moments is another scene
    def held() -> dict[str, Any] | None:
        return next(
            (
                s for s in _drafts(case, path)
                if _same(s.get("start"), at) and _same(s.get("end"), until) and not s.get("more")
            ),
            None,
        )

    # the whole of a video that already holds passages is not one place; a whole scene
    # still standing beside them, an older case's, is only answered
    if at is None and kind == "video":
        standing = held()
        if (standing is None or standing.get("abandoned")) and holds_passages(case, path):
            raise CaseError("scenes already hold passages of this video, so the whole of it is not one place")

    whole = whole_taker(case, path) if at is not None and held() is None else None
    if whole is not None:
        inspectwork.retime_scene(case, path, whole["id"], at, until)
        return scene_row(case, path, _draft(case, path, whole["id"]) or whole, kind)
    inspectwork.add_scenes(case, path, [{"start": at, "end": until, "label": word}])
    scene = held()
    if scene is None:
        raise CaseError("that file holds as many scenes as it can")
    return scene_row(case, path, scene, kind)


def holds_passages(case: Case, video: str) -> bool:
    """Whether a live scene of this video, still to prove or a proof's, states passages."""
    return any(
        not row.get("abandoned") and (row["start"] is not None if row["kind"] == "draft" else bool(row.get("moments")))
        for row in scenes_engine.video_scenes(case, video)["scenes"]
    )


def whole_taker(case: Case, video: str) -> dict[str, Any] | None:
    """The scene about the whole video that a time marked on it goes to, or None: the
    video's one live scene still to prove, about the whole video, with no live proof
    stating passages beside it (`lib/scenes.js`, wholeTaker). It keeps its label, its
    captures and its geolocating. One among other scenes still to prove, an older
    case's, is left as it is, and a proof about the whole video is an answer, not a
    question, so it lets the scene take the time. Saves stay lenient: only a mark asks."""
    if _kinds(case, [video]).get(video) != "video":
        return None
    rows = scenes_engine.video_scenes(case, video)["scenes"]
    live = [row for row in rows if not row.get("abandoned")]
    drafts = [row for row in live if row["kind"] == "draft"]
    if len(drafts) != 1 or drafts[0]["start"] is not None:
        return None
    if any(row["kind"] == "proof" and row.get("moments") for row in live):
        return None
    return _draft(case, video, drafts[0]["id"])


def _composed(case: Case, path: str) -> bool:
    items = case.media_items_by_paths([path])
    source = (items[0].get("source") if items else None) or {}
    return isinstance(source, dict) and source.get("op") == scenes_engine.COLLAGE_OP


def _same(a: Any, b: Any) -> bool:
    if a is None or b is None:
        return a is None and b is None
    return abs(float(a) - float(b)) < 1e-6


def _drafts(case: Case, path: str) -> list[dict[str, Any]]:
    work = inspectwork.find_work(case, path)
    return [s for s in ((work or {}).get("spec") or {}).get("scenes") or [] if isinstance(s, dict) and isinstance(s.get("id"), str)]



# -- the queue ------------------------------------------------------------------------


def queue(case: Case, with_proofs: bool = False) -> dict[str, Any]:
    """Every scene still to prove in the case, grouped by its file, the file most
    recently worked on first and each file's scenes in clip order, the whole video
    first. Those a proof took up are Proved and left out; the abandoned stay, marked.

    ``with_proofs`` adds, under ``proofs`` beside a file's scenes, the proofs made for
    a scene of it that state no place yet: the app's To-do lists them, while the
    extension, which only geolocates scenes, reads the queue without them."""
    proofs = scenes_engine.read_proofs(case)
    taken = _taken(proofs[0])
    works = [(subject, drafts) for subject, _touched, drafts in inspectwork.scene_works(case)]
    unplaced = scenes_engine.unplaced_proofs(case, proofs) if with_proofs else {}
    # a video whose only scenes left are proofs with no place has no draft in the queue
    worked = {subject for subject, _drafts in works}
    works += [(video, []) for video in unplaced if video not in worked]
    kinds = _kinds(case, [subject for subject, _drafts in works])
    places = _orders(case, [subject for subject, _drafts in works if kinds.get(subject) == "video"], proofs)
    present = _present(case, [subject for subject, _drafts in works])
    files = []
    for subject, drafts in works:
        item = present.get(subject)
        kind = kinds.get(subject, "video")
        if item is None:
            continue
        rows = [
            _placed(scene_row(case, subject, d, kind), places)
            for d in drafts
            if not _proved(proofs[0], taken, subject, d["id"], kind)
        ]
        open_proofs = unplaced.get(subject, [])
        if not rows and not open_proofs:
            continue
        rows.sort(key=lambda r: (-math.inf, -math.inf) if r["start"] is None else (r["start"], r["end"] or r["start"]))
        title = item.get("title") or item.get("filename") or subject.rsplit("/", 1)[-1]
        row: dict[str, Any] = {"video": subject, "title": str(title), "kind": kind, "scenes": rows}
        if with_proofs:
            row["proofs"] = [
                _placed(proof, places)
                for proof in sorted(open_proofs, key=lambda r: math.inf if r["start"] is None else r["start"])
            ]
        # a picture a collage exported names it, so its row opens the collage
        made_by = _collage_of(case, item)
        if made_by:
            row["collage"] = made_by
        files.append(row)
    return {"files": files, "geolocating": current(case)}
