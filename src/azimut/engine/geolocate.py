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

import math
import threading
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

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
    """A scene of a video is proved once a proof cites it; a picture marked to
    geolocate, once a proof lays it out."""
    return draft_id in taken or (kind == "image" and bool(scenes_engine.laid_out_by(specs, path)))


def _orders(case: Case, videos: list[str], proofs: Any = None) -> dict[tuple[str, str], int]:
    """Each draft's place among its video's scenes, proofs included, in clip order:
    what Inspect colours a scene by (`lib/scenes.js`, sceneList), so the queue, the
    pill and the reference window draw it in the same colour. A file that is not a
    video has no bar, and its scenes no place."""
    proofs = proofs if proofs is not None else scenes_engine.read_proofs(case)
    places: dict[tuple[str, str], int] = {}
    for video in videos:
        try:
            listed = scenes_engine.video_scenes(case, video, proofs)["scenes"]
        except CaseError:
            continue
        for at, scene in enumerate(listed):
            if scene.get("kind") == "draft":
                places[(video, scene["id"])] = at
    return places


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
    draft = _draft(case, held["video"], held["draft"]) if _in_case(case, held["video"]) else None
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
    return {"video": held["video"], "id": held["draft"], "label": str(scene.get("label") or "")}


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


# -- marking a whole file -------------------------------------------------------------


def mark(case: Case, path: str, label: Any = "") -> dict[str, Any]:
    """Mark a whole picture or video to geolocate, from outside Inspect: a scene about
    the whole file, or the one already there. A frame Inspect cut from a video belongs
    to that video's scenes, and a capture is an answer, not a question: neither is marked."""
    if label is not None and not isinstance(label, str):
        raise CaseError("a scene label must be text")
    entity = case.find_entity(attr="path", value=path)
    if entity is None or entity.get("type") != "media":
        raise CaseError("only a file of the case's media is marked to geolocate")
    kind = _kinds(case, [path]).get(path)
    if kind not in ("image", "video"):
        raise CaseError("only a picture or a video is marked to geolocate")
    if kind == "image" and path in scenes_engine.frame_origins(case, [path]):
        raise CaseError("a frame cut from a video belongs to its video's scenes")
    word = (label or "").strip()[: inspectwork.MAX_SCENE_LABEL]
    inspectwork.add_scenes(case, path, [{"start": None, "end": None, "label": word}])
    whole = next(iter(_whole_drafts(case, path)), None)
    if whole is None:
        raise CaseError("that file holds as many scenes as it can")
    return scene_row(case, path, whole, kind)


def _whole_drafts(case: Case, path: str) -> list[dict[str, Any]]:
    work = inspectwork.find_work(case, path)
    return [
        s for s in ((work or {}).get("spec") or {}).get("scenes") or []
        if isinstance(s, dict) and isinstance(s.get("id"), str) and s.get("start") is None and s.get("end") is None
    ]


# -- the queue ------------------------------------------------------------------------


def queue(case: Case) -> dict[str, Any]:
    """Every scene still to prove in the case, grouped by its file, the file most
    recently worked on first and each file's scenes in clip order, the whole video
    first. Those a proof took up are Proved and left out; the abandoned stay, marked."""
    proofs = scenes_engine.read_proofs(case)
    taken = _taken(proofs[0])
    works = [(subject, drafts) for subject, _touched, drafts in inspectwork.scene_works(case)]
    kinds = _kinds(case, [subject for subject, _drafts in works])
    places = _orders(case, [subject for subject, _drafts in works if kinds.get(subject) == "video"], proofs)
    files = []
    for subject, drafts in works:
        entity = _in_case(case, subject)
        kind = kinds.get(subject, "video")
        if entity is None:
            continue
        rows = [
            _placed(scene_row(case, subject, d, kind), places)
            for d in drafts
            if not _proved(proofs[0], taken, subject, d["id"], kind)
        ]
        if not rows:
            continue
        rows.sort(key=lambda r: (-math.inf, -math.inf) if r["start"] is None else (r["start"], r["end"] or r["start"]))
        files.append({"video": subject, "title": str(entity.get("label") or subject), "kind": kind, "scenes": rows})
    return {"files": files, "geolocating": current(case)}
