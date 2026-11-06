"""The scenes of a video: each stretch of one clip that a geolocation is about.

A long video often holds several places: a route filmed from a car, or a day's
events cut together. Each place is argued by its own proof, so a scene is either
a proof read back to the clip it rests on, or a stretch the analyst marked in
Inspect and has not proved yet.

**A proof's scene is stated or traced.** ``spec["scene"]`` holds what the analyst
declared: the starred video and the moments the place shows in it, since one place
often comes back in several extracts of one clip. A moment is an instant (a start)
or a passage (a start and a later end), and a proof that states none is about the
whole video: it prints no timecode anywhere. Without it the scene is read off the
panels: the first panel Inspect cut from a video names that video, and the instants
its frames were cut at say where in the clip the proof looks. That is how every
proof made before scenes existed joins its video's list, with nothing written to it.

**Its moments are stated through one narrow route** (`state_proof_scene`), which
writes ``spec["scene"]`` and nothing else. Taking them all back returns the proof to
its frames, and a proof that then states nothing its frames do not say keeps no scene.

**The video is found through the graph.** A frame's own record keeps the path of
the clip as it was when the frame was cut. The ``derived-from`` edge follows a
rename, so it is read first and the recorded path is only the fallback.

**A scene still to prove lives in the video's Inspect work**, one instant, one
stretch or the whole video, until a proof cites it (``scene.draft``). From then on the proof's own
moments are the ones shown and the draft is left out, so a scene is never said
twice, and a proof never writes into an Inspect work, but for one moment: as it
leaves for the Trash. The draft stays in the work all the same, hidden only while a
proof in the case cites it: the proof sent to the Trash gives it back at its own time,
and the proof restored takes it up again. A proof that came from no draft gives its
scene back as new ones (`give_back`), so no timecode leaves with a proof.
"""

from __future__ import annotations

import json
import math
import subprocess
from pathlib import Path
from typing import TYPE_CHECKING, Any

from .. import layout
from ..workspace import CaseError
from . import inspect as inspect_engine
from . import inspectwork
from . import links as link_engine
from . import media as media_engine
from . import satellite as satellite_engine

if TYPE_CHECKING:
    from ..workspace import Case

#: What Inspect records for a frame it cut from a video (`inspect.save_frame`).
FRAME_OP = "frame"
#: `media_items_by_paths` reads at most this many paths at once.
LOOKUP_BATCH = 500
#: How far past a clip's measured length a stated time may fall. A length read off
#: the container can come up a frame or so short, and the time is still the analyst's.
END_SLACK = 1.0
#: The most moments one proof states in its video.
MAX_MOMENTS = 20
#: The longest Inspect scene id a proof keeps (`lib/inspect.js` `uid` is about 20).
MAX_DRAFT_ID = 64
#: The most scenes a proof gives back: one per moment, or one for the whole video.
MAX_GIVEN = MAX_MOMENTS


class UnknownProof(LookupError):
    """No proof by that name in the case."""


class BadScene(ValueError):
    """A scene a proof cannot state: a video it was not cut from, or a draft id that is not one."""


class BadTime(BadScene):
    """A time that cannot be a scene's: not a number, negative, or out of order."""


def _seconds(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if not math.isfinite(value) or value < 0:
        return None
    return float(value)


def _moment(value: Any) -> dict[str, float | None] | None:
    """One moment as stored, or None when it does not read as one."""
    if not isinstance(value, dict):
        return None
    start = _seconds(value.get("start"))
    if start is None:
        return None
    if value.get("end") is None:
        return {"start": start, "end": None}
    end = _seconds(value.get("end"))
    return {"start": start, "end": end} if end is not None and end > start else None


def _moment_order(moment: dict[str, Any]) -> tuple[float, float]:
    return (moment["start"], moment["end"] if moment["end"] is not None else moment["start"])


def read_scene(scene: Any) -> dict[str, Any] | None:
    """A stated scene in its one shape, ``{video, moments, draft}``, or None when it
    names no video. ``gave`` joins it when the proof once gave its scene back to the
    video's work (`give_back`), and only then, so a proof that never did keeps the
    bytes it had.

    A moment that does not read as one, an end with no start or an end before the
    start, is left out rather than guessed at. The shape before moments, one
    ``start`` and ``end`` on the scene itself, reads as that one moment.
    """
    if not isinstance(scene, dict):
        return None
    video = scene.get("video")
    if not isinstance(video, str) or not video:
        return None
    held = scene.get("moments")
    if not isinstance(held, list):
        held = [{"start": scene.get("start"), "end": scene.get("end")}]
    moments = [m for m in (_moment(value) for value in held[:MAX_MOMENTS]) if m is not None]
    draft = scene.get("draft")
    held_gave = scene.get("gave")
    gave = [g for g in held_gave if isinstance(g, str) and g] if isinstance(held_gave, list) else []
    read: dict[str, Any] = {
        "video": video,
        "moments": sorted(moments, key=_moment_order),
        "draft": draft if isinstance(draft, str) and draft else None,
    }
    if gave:
        read["gave"] = list(dict.fromkeys(gave))[:MAX_GIVEN]
    return read


def cited_drafts(stated: dict[str, Any] | None) -> set[str]:
    """The Inspect scenes a stated scene keeps hidden: the draft it took up and the
    ones it gave back when it last went to the Trash."""
    if not stated:
        return set()
    return ({stated["draft"]} if stated["draft"] else set()) | set(stated.get("gave") or [])


def stated_scene(spec: dict[str, Any]) -> dict[str, Any] | None:
    """The scene the analyst declared on a proof, or None when it states none."""
    return read_scene(spec.get("scene"))


def _panel_sources(spec: dict[str, Any]) -> list[str]:
    return [
        panel["src"]
        for panel in spec.get("panels") or []
        if isinstance(panel, dict) and isinstance(panel.get("src"), str) and panel["src"]
    ]


def _parent_video(case: Case, item: dict[str, Any], cache: dict[str, str | None]) -> str | None:
    """The clip a frame was cut from, as the case holds it now."""
    entity_id = item.get("entity_id")
    if isinstance(entity_id, str) and entity_id:
        if entity_id not in cache:
            cache[entity_id] = None
            for link in case.links_of(entity_id):
                if link["type"] != link_engine.DERIVED_FROM or link["from"] != entity_id:
                    continue
                parent = case.get_entity(link["to"])
                path = link_engine.artifact_path(parent) if parent else None
                if parent and parent.get("type") == "media" and path:
                    cache[entity_id] = path
                    break
        if cache[entity_id]:
            return cache[entity_id]
    recorded = (item.get("source") or {}).get("from")
    return recorded if isinstance(recorded, str) and recorded else None


def frame_origins(case: Case, paths: list[str]) -> dict[str, tuple[str, float]]:
    """For each of these files that Inspect cut from a video: the video and the instant."""
    unique = list(dict.fromkeys(p for p in paths if p))
    origins: dict[str, tuple[str, float]] = {}
    parents: dict[str, str | None] = {}
    for at in range(0, len(unique), LOOKUP_BATCH):
        for item in case.media_items_by_paths(unique[at : at + LOOKUP_BATCH]):
            source = item.get("source")
            if not isinstance(source, dict):
                continue
            if source.get("type") != "inspect" or source.get("op") != FRAME_OP:
                continue
            moment = _seconds(source.get("time"))
            video = _parent_video(case, item, parents)
            if moment is not None and video:
                origins[item["path"]] = (video, moment)
    return origins


def traced_video(spec: dict[str, Any], origins: dict[str, tuple[str, float]]) -> str | None:
    """The video the first panel Inspect cut from one names, or None."""
    return next((origins[src][0] for src in _panel_sources(spec) if src in origins), None)


def star_video(case: Case, spec: dict[str, Any]) -> tuple[str | None, list[dict[str, Any]]]:
    """The video a proof is about (★) and the moments it states in it.

    The one the proof states while the case holds it, with its moments, else the one
    its first frame was cut from, about the whole of it. ``(None, [])`` for a proof
    that rests on no video of the case. Any other video among the panels only
    confirms the place, so this is the one a dated proof dates.
    """
    stated = stated_scene(spec)
    if stated and _case_video(case, stated["video"]):
        return stated["video"], stated["moments"]
    traced = traced_video(spec, frame_origins(case, _panel_sources(spec)))
    if traced and _case_video(case, traced):
        return traced, []
    return None, []


def proof_scene(
    spec: dict[str, Any], origins: dict[str, tuple[str, float]]
) -> dict[str, Any] | None:
    """Where in which video a proof looks, or None when it rests on no video."""
    stated = stated_scene(spec)
    sources = _panel_sources(spec)
    video = stated["video"] if stated else traced_video(spec, origins)
    if video is None:
        return None
    instants = sorted({origins[src][1] for src in sources if src in origins and origins[src][0] == video})
    return {
        "video": video,
        "moments": stated["moments"] if stated else [],
        "at": instants,
        "stated": stated is not None,
        "draft": stated["draft"] if stated else None,
    }


def proof_specs(case: Case) -> list[tuple[str, dict[str, Any]]]:
    """Every proof's spec, by name. One unreadable file is skipped, not fatal."""
    out = []
    for path in sorted(case.subdir("proofs").joinpath(layout.META_DIR).glob("*.json")):
        try:
            spec = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(spec, dict) and spec.get("azimut_proof") == 1:
            out.append((path.stem, spec))
    return out


def _points(case: Case, spec: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for point in satellite_engine.spec_points(spec):
        place = satellite_engine.place_at(case, point["lat"], point["lon"])
        out.append(
            {
                "lat": point["lat"],
                "lon": point["lon"],
                "coords": point.get("coords") or f"{point['lat']:.6f}, {point['lon']:.6f}",
                "label": point.get("label") or "",
                "pov": bool(point.get("pov")),
                "place_id": place["id"] if place else None,
            }
        )
    return out


def _existing(case: Case, rel: str | None) -> str | None:
    if not rel:
        return None
    try:
        return rel if case.resolve_inside(rel).exists() else None
    except CaseError:
        return None


def _proof_row(case: Case, name: str, spec: dict[str, Any], scene: dict[str, Any]) -> dict[str, Any]:
    proof = case.find_entity(attr="spec", value=layout.proof_spec_rel(name))
    attrs = (proof or {}).get("attrs") or {}
    zone = attrs.get("when_zone") or spec.get("whenZone")
    return {
        "kind": "proof",
        "proof": name,
        "proof_id": proof["id"] if proof else None,
        "title": spec.get("title") or name,
        **scene,
        "points": _points(case, spec),
        "png": _existing(case, layout.proof_export_rel(name)),
        "thumb": _existing(case, spec.get("thumb") if isinstance(spec.get("thumb"), str) else None),
        "when": spec.get("when") or None,
        "when_zone": zone if isinstance(zone, str) and zone else None,
        "description": spec.get("description") or None,
    }


def _order(scene: dict[str, Any]) -> tuple[float, float]:
    """Where a scene comes in its clip: a draft's start, a proof's first moment, else
    the first frame it was built on, and the end to part two that start together.
    A draft about the whole video comes first."""
    if scene["kind"] == "draft" and scene["start"] is None:
        return (-math.inf, -math.inf)
    first = scene["moments"][0] if scene.get("moments") else scene
    start = first.get("start")
    if start is None:
        start = scene["at"][0] if scene.get("at") else math.inf
    end = first.get("end")
    return (start, end if end is not None else start)


#: The states of a scene still to prove (`engine/geolocate.py`); a proof is Proved.
TODO = "todo"
PROGRESS = "progress"
ABANDONED = "abandoned"


def _captured(case: Case, paths: Any) -> list[str]:
    """The captures still in the case, in the order they were attached. One sent to
    the Trash stays listed in the work and comes back with its file."""
    wanted = [p for p in paths if isinstance(p, str) and p] if isinstance(paths, list) else []
    if not wanted:
        return []
    present = {item.get("path") for item in case.media_items_by_paths(wanted)}
    return [p for p in wanted if p in present]


def draft_row(case: Case, video: str, draft: dict[str, Any]) -> dict[str, Any]:
    """A scene still to prove as Inspect and the queue read it: its time, its label, its
    state, the captures it gathered that are still in the case, and why it was left."""
    captures = _captured(case, draft.get("captures"))
    abandoned = draft.get("abandoned") if isinstance(draft.get("abandoned"), dict) else None
    start = _seconds(draft.get("start"))
    end = _seconds(draft.get("end")) if start is not None else None
    return {
        "kind": "draft",
        "video": video,
        "id": draft["id"],
        "start": start,
        "end": end,
        "label": str(draft.get("label") or ""),
        "state": ABANDONED if abandoned else PROGRESS if captures else TODO,
        "captures": captures,
        "abandoned": abandoned,
    }


def read_proofs(case: Case) -> tuple[list[tuple[str, dict[str, Any]]], dict[str, tuple[str, float]]]:
    """Every proof's spec and where its frames were cut, read once for several videos."""
    specs = proof_specs(case)
    return specs, frame_origins(case, [src for _name, spec in specs for src in _panel_sources(spec)])


def video_scenes(
    case: Case,
    video: str,
    proofs: tuple[list[tuple[str, dict[str, Any]]], dict[str, tuple[str, float]]] | None = None,
) -> dict[str, Any]:
    """The scenes of one video, in the order they come in the clip.

    Proofs first resolve to the video they rest on; the drafts still waiting in the
    video's Inspect work join them, minus any a proof in the case has taken up, even
    one whose ★ has since moved to another video. ``taken`` names those, so Inspect
    hides them in the work it holds too.

    ``used`` names, for each frame of this video a proof lays out, the proofs that
    do, whichever video each of them is about: Inspect says so on the frame.
    """
    entity = case.find_entity(attr="path", value=video)
    if entity is None or entity.get("type") != "media":
        raise CaseError("that file is not in the case")
    items = case.media_items_by_paths([video])
    if not items or items[0].get("kind") != "video":
        raise CaseError("only a video has scenes")

    specs, origins = proofs if proofs is not None else read_proofs(case)
    scenes: list[dict[str, Any]] = []
    taken: set[str] = set()
    used: dict[str, list[dict[str, str]]] = {}
    for name, spec in specs:
        for src in dict.fromkeys(_panel_sources(spec)):
            if src in origins and origins[src][0] == video:
                used.setdefault(src, []).append({"proof": name, "title": spec.get("title") or name})
        taken |= cited_drafts(stated_scene(spec))
        scene = proof_scene(spec, origins)
        if scene is None:
            continue
        if scene["video"] == video:
            scenes.append(_proof_row(case, name, spec, scene))

    work = inspectwork.find_work(case, video)
    drafts = [d for d in ((work or {}).get("spec") or {}).get("scenes") or [] if isinstance(d, dict)]
    hidden = sorted(taken & {d.get("id") for d in drafts if isinstance(d.get("id"), str)})
    for draft in drafts:
        if draft.get("id") in taken:
            continue
        start, end = _seconds(draft.get("start")), _seconds(draft.get("end"))
        whole = draft.get("start") is None and draft.get("end") is None
        if (start is None and not whole) or (start is not None and end is not None and end <= start):
            continue
        scenes.append(draft_row(case, video, draft))
    scenes.sort(key=_order)
    return {"video": video, "video_id": entity["id"], "scenes": scenes, "used": used, "taken": hidden}


def _case_video(case: Case, path: str) -> bool:
    entity = case.find_entity(attr="path", value=path)
    if entity is None or entity.get("type") != "media":
        return False
    items = case.media_items_by_paths([path])
    return bool(items) and items[0].get("kind") == "video"


def _stated_moments(value: Any) -> list[dict[str, float | None]]:
    """The moments a request states, checked one by one and against each other.

    Each is an instant or a passage. They come back in clip order. Two passages that
    overlap, or one instant said twice, are refused rather than merged: they read as
    a slip, and which one was meant is the analyst's to say.
    """
    if not isinstance(value, list):
        raise BadTime("moments must be a list")
    if len(value) > MAX_MOMENTS:
        raise BadTime(f"a proof states at most {MAX_MOMENTS} moments")
    instants: list[float] = []
    passages: list[tuple[float, float]] = []
    for item in value:
        if not isinstance(item, dict):
            raise BadTime("a moment is a start, and an end or none")
        start = _seconds(item.get("start"))
        if start is None:
            raise BadTime("a moment's start must be a time in seconds, from 0")
        if item.get("end") is None:
            instants.append(start)
            continue
        end = _seconds(item.get("end"))
        if end is None:
            raise BadTime("a moment's end must be a time in seconds, from 0")
        if end <= start:
            raise BadTime("a moment must end after it starts")
        passages.append((start, end))
    passages.sort()
    if any(after[0] < before[1] for before, after in zip(passages, passages[1:])):
        raise BadTime("two passages overlap")
    if len(instants) != len(set(instants)):
        raise BadTime("one instant is stated twice")
    moments: list[dict[str, float | None]] = [{"start": t, "end": None} for t in instants]
    moments += [{"start": start, "end": end} for start, end in passages]
    return sorted(moments, key=_moment_order)


def _clip_length(case: Case, video: str) -> float:
    """The clip's length as ffprobe reads it, or 0 when it cannot be read."""
    try:
        duration = inspect_engine.probe(case, video).get("duration")
    except (OSError, ValueError, CaseError, subprocess.SubprocessError):
        return 0.0
    return float(duration) if isinstance(duration, (int, float)) and math.isfinite(duration) else 0.0


def _read_proof(path: Path) -> dict[str, Any]:
    try:
        spec = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise UnknownProof("no such proof") from exc
    except (OSError, json.JSONDecodeError) as exc:
        raise CaseError("that proof could not be read") from exc
    if not isinstance(spec, dict) or spec.get("azimut_proof") != 1:
        raise UnknownProof("no such proof")
    return spec


def _scene_video(
    case: Case, spec: dict[str, Any], wanted: str | None = None
) -> tuple[str, str | None, dict[str, tuple[str, float]]]:
    """The video a proof's time is in: the one asked for, else the one it states while
    the case holds it, else the one its frames were cut from. With the traced one, and
    the frames' origins.

    A video asked for is one of the case that a panel was cut from, or the one the
    proof already states: the ★ moves between the videos the proof shows, never to a
    clip it has nothing from.
    """
    origins = frame_origins(case, _panel_sources(spec))
    traced = traced_video(spec, origins)
    stated = stated_scene(spec)
    if wanted is not None:
        cut_from = {origin for origin, _time in origins.values()}
        if not _case_video(case, wanted) or (wanted not in cut_from and wanted != (stated or {}).get("video")):
            raise BadScene("that video is not one this proof's frames were cut from")
        return wanted, traced, origins
    video = stated["video"] if stated and _case_video(case, stated["video"]) else traced
    if video is None:
        raise CaseError("this proof rests on no video in the case")
    return video, traced, origins


def _wanted_video(value: Any) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or not value:
        raise BadScene("a video is named by its path in the case")
    return value


def _wanted_draft(value: Any) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or not value or len(value) > MAX_DRAFT_ID:
        raise BadScene("a scene to geolocate is named by its id")
    return value


def state_proof_scene(
    case: Case, name: str, moments: Any, video: Any = None, draft: Any = None
) -> dict[str, Any]:
    """Say when in its video a proof happens, and answer with its scene as now read.

    ``moments`` are the instants and passages the place shows in; none takes the time
    back, so the proof sits at the frames it was built on again. Only
    ``spec["scene"]`` is written: the video it names, the moments, and the draft it
    came from. The video is the one asked for, else the one the proof states, else
    the one its frames were cut from. ``draft`` is the Inspect scene the proof takes
    up, given once: a proof that already took up another one refuses it. A proof that
    ends up stating nothing its frames do not say keeps no scene at all, exactly the
    proof it was before.
    """
    stated_moments = _stated_moments(moments)
    wanted = _wanted_video(video)
    wanted_draft = _wanted_draft(draft)

    path = case.resolve_inside(layout.proof_spec_rel(name))
    # The clip is measured before the case is locked: ffprobe has the time it needs,
    # and nothing else waits on it.
    latest = max((m["end"] or m["start"] or 0.0 for m in stated_moments), default=None)
    if latest is not None:
        length = _clip_length(case, _scene_video(case, _read_proof(path), wanted)[0])
        if length and latest > length + END_SLACK:
            raise BadTime("that time is past the end of the video")

    with case.lock:
        spec = _read_proof(path)
        target, traced, origins = _scene_video(case, spec, wanted)
        stated = stated_scene(spec)
        held = stated["draft"] if stated else None
        if wanted_draft is not None and held not in (None, wanted_draft):
            raise CaseError("this proof already takes up another scene")
        draft_id = wanted_draft or held
        gave = (stated or {}).get("gave")
        if not stated_moments and draft_id is None and not gave and target == traced:
            spec.pop("scene", None)
        else:
            spec["scene"] = {
                "video": target, "moments": stated_moments, "draft": draft_id, **({"gave": gave} if gave else {}),
            }
        media_engine.write_json_atomic(path, spec)
    # It names a video either way: the one stated, else the one its frames were cut from.
    return {"proof": name, **(proof_scene(spec, origins) or {})}


def give_back(case: Case, proof: dict[str, Any], leaving: set[str]) -> list[str]:
    """Give a proof's scene back to its video's Inspect work as the proof goes to the
    Trash, and answer with the ids of the scenes added.

    A timecode is knowledge about the video, not only the proof's, so it must not leave
    with it: one scene to geolocate per moment the proof states, since such a scene
    holds one, or one about the whole video when it states none, each named with the
    proof's title. A proof that took a scene up, or already gave one back, adds nothing:
    that scene is still in a work, and shows again on its own once no proof in the case
    cites it. Nor does a proof on no video, or one whose video leaves with it.

    The ids added are written on the proof (``scene.gave``) before its file moves to
    the Trash. Restored, it cites them again, which hides them as a taken draft is
    hidden; nothing is ever deleted from the work, so whatever the analyst did to them
    meanwhile is kept, and a second delete gives nothing twice.
    """
    rel = (proof.get("attrs") or {}).get("spec")
    if not isinstance(rel, str) or not rel:
        return []
    path = case.resolve_inside(rel)
    with case.lock:
        try:
            spec = _read_proof(path)
        except (UnknownProof, CaseError):
            return []
        video, moments = star_video(case, spec)
        holder = case.find_entity(attr="path", value=video) if video else None
        if video is None or holder is None or holder["id"] in leaving:
            return []
        stated = stated_scene(spec)
        cited = cited_drafts(stated)
        if cited & inspectwork.scene_ids(case):
            return []
        title = str(spec.get("title") or proof.get("label") or "")
        wanted = [{"start": m["start"], "end": m["end"]} for m in moments] or [{"start": None, "end": None}]
        added = inspectwork.add_scenes(case, video, [{**m, "label": title} for m in wanted])
        if not added:
            return []
        spec["scene"] = {
            "video": video,
            "moments": moments,
            "draft": stated["draft"] if stated else None,
            "gave": added,
        }
        media_engine.write_json_atomic(path, spec)
        return added
