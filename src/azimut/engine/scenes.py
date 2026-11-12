"""The scenes of a video: each stretch of one clip that a geolocation is about.

A long video often holds several places: a route filmed from a car, or a day's
events cut together. Each place is argued by its own proof, so a scene is either
a proof read back to the clip it rests on, or a stretch the analyst marked in
Inspect and has not proved yet.

**A proof's scene is stated or traced.** ``spec["scene"]`` holds what the analyst
declared: the starred video and the moments the place shows in it, since one place
often comes back in several extracts of one clip. A moment is an instant (a start)
or a passage (a start and a later end), and a stated scene with none is about the
whole video: it prints no timecode anywhere. Without it the scene is read off the
panels: the first panel Inspect cut from a video names that video, and the instants
its frames were cut at say where in the clip the proof looks. That is how every
proof made before scenes existed joins its video's list, with nothing written to it.
A traced proof is about the whole video too, but it said nothing: Geo Proof may still
propose the scene still to prove its frames fall in, where a stated whole video is the
analyst's answer and is never offered another.

**Its moments are stated through one narrow route** (`state_proof_scene`), which
writes ``spec["scene"]`` and nothing else. The whole video asked for is kept as
``{"video", "moments": [], "draft"}``. Only ``traced`` takes the proof back to its
frames, the Undo of its first time: the scene it took up goes back to geolocate, and a
proof that then states nothing its frames do not say keeps no scene.

**A scene may hold the clip cut for its post** (``clip``, `engine/postclips.py`): a case
file of its own, cut from a passage of the ★ video. It stays with the scene while the ★
does, and a scene holding one is never taken back to the frames.

**The video is found through the graph.** A frame's own record keeps the path of
the clip as it was when the frame was cut. The ``derived-from`` edge follows a
rename, so it is read first and the recorded path is only the fallback.

**A panel made from the footage ties the proof to it too** (`panel_ties`). A capture
Horizon or Satellite made over a frame, over a collage of the video's frames, or over
another such capture, is walked up ``derived-from`` to that footage, a bounded number of
steps and each file once: it carries the frame's instant, or every piece's. A capture
a scene gathered while it was geolocated (``captures``) points at that scene. Such a
panel is no frame, so it pins nothing and its proof is not traced to the video: Geo Proof
offers the scene, and the tie is written as Make the proof's is, ``scene.draft`` through
`state_proof_scene`, which accepts the video it is tied to. From then on the proof is
read back like any other, and the To-do no longer lists the scene.

**A scene still to prove lives in the video's Inspect work**, one instant, one
stretch, several of them where the place shows again (``more``, `inspectwork.scene_moments`)
or the whole video, until a proof cites it (``scene.draft``). From then on the proof's own
moments are the ones shown and the draft is left out, so a scene is never said
twice, and a proof never writes into an Inspect work, but for one moment: as it
leaves for the Trash. The draft stays in the work all the same, hidden only while a
proof in the case cites it: the proof sent to the Trash gives it back at its own time,
and the proof restored takes it up again. A proof that came from no draft gives its
scene back as a new one (`give_back`), so no timecode leaves with a proof.
"""

from __future__ import annotations

import json
import math
import subprocess
from collections.abc import Mapping, Sequence
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING, Any

from .. import layout
from ..workspace import CaseError
from . import geo as geo_engine
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
#: The most scenes a proof names as given back (`scene.gave`): it gives one now, holding
#: every moment, where it once gave one per moment.
MAX_GIVEN = MAX_MOMENTS
#: The attribute binding the date a proof states for its footage (a Claim,
#: `api/proofs._date_the_material`) to the proof, by the proof's spec path.
DATED_BY = "proof"


def dating_label(name: str) -> str:
    """What the date a proof states for its footage is called, until someone rewords it."""
    return f"Material of {name} was taken"


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


def read_clip(value: Any) -> dict[str, Any] | None:
    """The clip a scene holds for its post, ``{path, start, end}``, or None when it does
    not read as one: a case path and the passage it was cut from, in seconds."""
    if not isinstance(value, dict):
        return None
    path = value.get("path")
    start, end = _seconds(value.get("start")), _seconds(value.get("end"))
    if not isinstance(path, str) or not path or start is None or end is None or end <= start:
        return None
    return {"path": path, "start": start, "end": end}


def read_scene(scene: Any) -> dict[str, Any] | None:
    """A stated scene in its one shape, ``{video, moments, draft}``, or None when it
    names no video. ``gave`` joins it when the proof once gave its scene back to the
    video's work (`give_back`), and ``clip`` when a clip was cut for its post
    (`read_clip`), each only then, so a proof that holds neither keeps the bytes it had.

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
    clip = read_clip(scene.get("clip"))
    if clip:
        read["clip"] = clip
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


#: What Inspect records for a picture it composed from pieces (`inspect.compose_perspective`), or bent
#: from one (`inspect.straighten_pieces`).
COLLAGE_OP = "collage"

#: Where each picture was cut from a video: the video, and the instant when one is known.
Origins = dict[str, tuple[str, float | None]]


def _cut_frames(case: Case, items: list[dict[str, Any]], parents: dict[str, str | None]) -> dict[str, tuple[str, float]]:
    origins: dict[str, tuple[str, float]] = {}
    for item in items:
        source = item.get("source")
        if not isinstance(source, dict) or source.get("type") != "inspect" or source.get("op") != FRAME_OP:
            continue
        moment = _seconds(source.get("time"))
        video = _parent_video(case, item, parents)
        if moment is not None and video:
            origins[item["path"]] = (video, moment)
    return origins


def collage_video(case: Case, pieces: list[tuple[Any, Any]]) -> tuple[str, list[float]] | None:
    """The one video a collage's pieces were all cut from, and their instants, or None.

    A piece is a video, at an instant or at none recorded, a frame Inspect cut from one,
    or a picture composed in turn from one video's pieces; a collage that also holds any
    other picture, or pieces of two videos, is a picture of its own. The instants are
    those known, sorted: none at all when every piece was filed without one.
    """
    return _collage_video(_Trace(case), pieces, 0)


#: How deep a collage's pieces are followed through pictures composed from other pieces:
#: a straightened collage is one picture of the pieces it bent.
_COMPOSED_DEPTH = 3


class _Trace:
    """One reading of composed pictures back to the video they come from: each file
    looked up once, the parent of each frame asked once, and the collage documents read
    once, the first time a picture is missing its instants."""

    def __init__(self, case: Case) -> None:
        self.case = case
        self.parents: dict[str, str | None] = {}
        self._items: dict[str, dict[str, Any] | None] = {}
        self._exports: dict[str, list[tuple[Any, Any]]] | None = None

    def items(self, paths: list[str]) -> dict[str, dict[str, Any]]:
        """These files' media items, by path, the ones not looked up yet read in batches."""
        missing = [p for p in dict.fromkeys(paths) if p not in self._items]
        for at in range(0, len(missing), LOOKUP_BATCH):
            batch = missing[at : at + LOOKUP_BATCH]
            self._items.update(dict.fromkeys(batch))
            self._items.update((item["path"], item) for item in self.case.media_items_by_paths(batch))
        return {p: item for p in paths if (item := self._items.get(p)) is not None}

    def known(self, items: list[dict[str, Any]]) -> None:
        """Items already read, so they are not asked for again."""
        self._items.update((item["path"], item) for item in items if isinstance(item.get("path"), str))

    def exported(self, path: str) -> list[tuple[Any, Any]] | None:
        """The pieces of the collage that last exported this picture, if one did."""
        if self._exports is None:
            self._exports = inspectwork.collage_exports(self.case)
        return self._exports.get(path)

    def documents(self, collages: list[dict[str, Any]]) -> None:
        """Every collage document, read already: what `exported` answers from, and every
        file they lay out looked up in one go, with the files the pictures among them
        were composed from, so a straightened collage costs no lookup of its own."""
        self._exports = {c["export"]: c["pieces"] for c in collages if c.get("export")}
        items = self.items([p for c in collages for p, _t in c["pieces"] if isinstance(p, str) and p])
        inner = [
            p for item in items.values()
            if (source := item.get("source")) and isinstance(source, dict) and source.get("op") == COLLAGE_OP
            for p in source.get("sources") or [] if isinstance(p, str) and p
        ]
        self.items(inner)


def _collage_video(trace: _Trace, pieces: list[tuple[Any, Any]], depth: int) -> tuple[str, list[float]] | None:
    paths = [p for p, _t in pieces if isinstance(p, str) and p]
    if not pieces or len(paths) != len(pieces):
        return None
    items = trace.items(paths)
    cut = _cut_frames(trace.case, list(items.values()), trace.parents)
    videos: set[str] = set()
    times: list[float] = []
    for path, time in pieces:
        if path in cut:
            videos.add(cut[path][0])
            times.append(cut[path][1])
        elif (items.get(path) or {}).get("kind") == "video":
            # the video itself, at the instant the piece was cut at when it was recorded
            videos.add(path)
            if (at := _seconds(time)) is not None:
                times.append(at)
        else:
            # a piece that is itself a picture composed from one video's frames, such as
            # a straightened collage, stands for those frames
            inner = _composed_pieces(trace, items.get(path)) if depth < _COMPOSED_DEPTH else None
            found = _collage_video(trace, inner, depth + 1) if inner else None
            if found is None:
                return None
            videos.add(found[0])
            times.extend(found[1])
    return (videos.pop(), sorted(times)) if len(videos) == 1 else None


def _composed_pieces(trace: _Trace, item: dict[str, Any] | None) -> list[tuple[Any, Any]] | None:
    """The pieces a composed picture records (`source.sources`), each with its instant
    (`source.times`). A picture exported before the instants were recorded takes them
    from the collage that exported it, while that collage still lays the same files out,
    else keeps its pieces with no instant: they still name the video."""
    source = (item or {}).get("source")
    if not isinstance(source, dict) or source.get("type") != "inspect" or source.get("op") != COLLAGE_OP:
        return None
    files, moments = source.get("sources"), source.get("times")
    if not isinstance(files, list) or not files:
        return None
    if isinstance(moments, list) and len(moments) == len(files):
        return list(zip(files, moments))
    held = trace.exported(str((item or {}).get("path") or ""))
    if held and [path for path, _time in held] == files:
        return held
    return [(path, None) for path in files]


def _collage_origins(trace: _Trace, items: list[dict[str, Any]]) -> Origins:
    """A picture composed from one video's frames, read back to that video at its first
    piece, or at no instant when none of its pieces kept one."""
    origins: Origins = {}
    for item in items:
        pieces = _composed_pieces(trace, item)
        found = _collage_video(trace, pieces, 0) if pieces else None
        if found:
            origins[item["path"]] = (found[0], found[1][0] if found[1] else None)
    return origins


def frame_origins(case: Case, paths: list[str]) -> Origins:
    """For each of these files that Inspect cut from a video: the video and the instant.
    A collage composed from one video's frames counts, at its first piece, and at no
    instant (None) when it was filed before its pieces' instants were recorded."""
    unique = list(dict.fromkeys(p for p in paths if p))
    origins: Origins = {}
    trace = _Trace(case)
    for at in range(0, len(unique), LOOKUP_BATCH):
        items = case.media_items_by_paths(unique[at : at + LOOKUP_BATCH])
        trace.known(items)
        origins.update(_cut_frames(case, items, trace.parents))
        origins.update(_collage_origins(trace, items))
    return origins


def _video_layouts(trace: _Trace, collages: list[dict[str, Any]]) -> list[tuple[dict[str, Any], str, list[float]]]:
    """Each of these collage documents laid out from one video's pieces alone, with that
    video and the instants known."""
    trace.documents(collages)
    out = []
    for collage in collages:
        found = _collage_video(trace, collage["pieces"], 0)
        if found:
            out.append((collage, found[0], found[1]))
    return out


def video_collages(case: Case, video: str) -> list[dict[str, Any]]:
    """The collages composed from this video's frames alone, each with its pieces'
    instants: a collage belongs to the scenes of its video by them, as a frame does.
    One whose pieces kept no instant still belongs to the video, with no time."""
    rows = []
    for collage, found, times in _video_layouts(_Trace(case), inspectwork.collage_pieces(case)):
        if found != video:
            continue
        rows.append({
            "collage": collage["name"],
            "title": collage["title"],
            "export": collage["export"],
            "current": collage["current"],
            "times": times,
            "start": times[0] if times else None,
            "end": times[-1] if times and times[-1] > times[0] else None,
        })
    return rows


def collage_times(case: Case) -> dict[str, list[list[float]]]:
    """Each video's collages by the instants of their pieces, in one pass over the
    collage documents: what a scene counts among what its video gives it."""
    out: dict[str, list[list[float]]] = {}
    for _collage, video, times in _video_layouts(_Trace(case), inspectwork.collage_layouts(case)):
        out.setdefault(video, []).append(times)
    return out


def traced_video(spec: dict[str, Any], origins: Origins) -> str | None:
    """The video the first panel Inspect cut from one names, or None."""
    return next((origins[src][0] for src in _panel_sources(spec) if src in origins), None)


# -- what ties a panel to a video's scene without being cut from it -------------------

#: How far up ``derived-from`` a panel is followed to the footage it was made from: a
#: capture of a straightened collage is three steps from the frames, four from the video.
TIE_DEPTH = 6
#: The most panels one read of their ties takes (`panel_ties`).
MAX_TIE_PANELS = 200


def _footage_of(trace: _Trace, path: str) -> tuple[str, list[float]] | None:
    """The video a case file is footage of, with the instants it shows: a frame Inspect
    cut, at its instant; a collage of one video's frames, at every piece's; the video
    itself, at none. None for any other file."""
    item = trace.items([path]).get(path)
    if item is None:
        return None
    if item.get("kind") == "video":
        return path, []
    cut = _cut_frames(trace.case, [item], trace.parents)
    if path in cut:
        return cut[path][0], [cut[path][1]]
    pieces = _composed_pieces(trace, item)
    return _collage_video(trace, pieces, 0) if pieces else None


def _made_from(trace: _Trace, path: str) -> list[str]:
    """What a case file was made from: its ``derived-from`` edges, which follow a rename,
    else the files its producer recorded (`media._source_paths`)."""
    item = trace.items([path]).get(path) or {}
    entity_id = item.get("entity_id")
    parents: list[str] = []
    if isinstance(entity_id, str) and entity_id:
        for link in trace.case.links_of(entity_id):
            if link["type"] != link_engine.DERIVED_FROM or link["from"] != entity_id:
                continue
            parent = trace.case.get_entity(link["to"])
            rel = link_engine.artifact_path(parent) if parent else None
            if rel:
                parents.append(rel)
    if parents:
        return parents
    source = item.get("source")
    if not isinstance(source, dict):
        return []
    recorded = [source.get("from"), *(source.get("sources") or [])]
    return [p for p in recorded if isinstance(p, str) and p]


def _composed(trace: _Trace, path: str) -> bool:
    """Whether a case file is a picture Inspect composed from pieces (`COLLAGE_OP`)."""
    source = (trace.items([path]).get(path) or {}).get("source")
    return isinstance(source, dict) and source.get("type") == "inspect" and source.get("op") == COLLAGE_OP


def _footage_up(trace: _Trace, path: str) -> dict[str, set[float]]:
    """The footage a picture was made from, walked up ``derived-from`` breadth first, at
    most `TIE_DEPTH` steps and each file once, so a loop ends: each video reached, with the
    instants shown. A branch stops at the first footage it meets, and at a collage of
    several videos' pieces, which is a picture of its own."""
    found: dict[str, set[float]] = {}
    seen = {path}
    frontier = [path]
    for _step in range(TIE_DEPTH):
        further: list[str] = []
        for current in frontier:
            for parent in _made_from(trace, current):
                if parent in seen:
                    continue
                seen.add(parent)
                footage = _footage_of(trace, parent)
                if footage is not None:
                    found.setdefault(footage[0], set()).update(footage[1])
                elif not _composed(trace, parent):
                    further.append(parent)
        if not further:
            break
        frontier = further
    return found


def _gathered(case: Case, trace: _Trace, wanted: set[str]) -> dict[str, list[tuple[str, str]]]:
    """For each of these files a scene of a video gathered on the map (``captures``), that
    video and that scene's id, in the order the works list them."""
    out: dict[str, list[tuple[str, str]]] = {}
    for subject, spec in inspectwork.subject_specs(case).items():
        for draft in (spec or {}).get("scenes") or []:
            if not isinstance(draft, dict) or not isinstance(draft.get("id"), str):
                continue
            for path in draft.get("captures") or []:
                if path in wanted and (subject, draft["id"]) not in out.get(path, []):
                    out.setdefault(path, []).append((subject, draft["id"]))
    # a picture's scenes are proved by laying the picture out, never by a capture of it
    subjects = trace.items([subject for held in out.values() for subject, _id in held])
    videos = {path for path, item in subjects.items() if item.get("kind") == "video"}
    return {path: [(video, d) for video, d in held if video in videos] for path, held in out.items()}


def panel_ties(case: Case, paths: Sequence[str]) -> list[dict[str, Any]]:
    """What ties each of these panels to a video's scene without being cut from it, in the
    panels' order: ``{src, video, times, scene}`` per video, and per scene pointed at.

    A frame or a collage of one video is read off the panel itself (`frame_origins`), so
    it is left out, and so is a collage of several videos, a picture of its own. Any other
    panel is walked up ``derived-from`` to the footage it was made from (`_footage_up`): a
    capture made over a frame gives that frame's instant, one made over a collage the
    instants of every piece. A capture a scene of a video gathered on the map
    (``captures`` in the video's Inspect work) points at that scene (``scene``), whatever
    it was made from. Which scene the proof then takes up is Geo Proof's to say, by the
    rule its frames follow (`lib/proofScene.sceneOffer`). A read: nothing is written.
    """
    unique = [p for p in dict.fromkeys(paths) if isinstance(p, str) and p][:MAX_TIE_PANELS]
    if not unique:
        return []
    trace = _Trace(case)
    trace.items(unique)
    # footage itself is read off the panel; a collage of several videos is a picture of its own
    own = [p for p in unique if _footage_of(trace, p) is None and not _composed(trace, p)]
    gathered = _gathered(case, trace, set(own)) if own else {}
    walked = {path: _footage_up(trace, path) for path in own}
    # only a video still in the case is offered
    present = trace.items([v for found in walked.values() for v in found])
    ties: list[dict[str, Any]] = []
    for path in own:
        found = {
            video: times for video, times in walked[path].items() if (present.get(video) or {}).get("kind") == "video"
        }
        pointed = gathered.get(path, [])
        for video in [*found, *dict.fromkeys(v for v, _id in pointed if v not in found)]:
            times = sorted(found.get(video, set()))
            scenes: list[str | None] = [d for v, d in pointed if v == video]
            for scene in scenes or [None]:
                ties.append({"src": path, "video": video, "times": times, "scene": scene})
    return ties


def tied_videos(case: Case, spec: dict[str, Any]) -> list[str]:
    """The videos a proof's panels are tied to without being cut from them, first first."""
    return list(dict.fromkeys(tie["video"] for tie in panel_ties(case, _panel_sources(spec))))


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
    spec: dict[str, Any], origins: Origins
) -> dict[str, Any] | None:
    """Where in which video a proof looks, or None when it rests on no video."""
    stated = stated_scene(spec)
    sources = _panel_sources(spec)
    video = stated["video"] if stated else traced_video(spec, origins)
    if video is None:
        return None
    # a collage filed before its pieces' instants were recorded names its video at none
    instants = sorted({
        at for src in sources if src in origins and origins[src][0] == video and (at := origins[src][1]) is not None
    })
    read: dict[str, Any] = {
        "video": video,
        "moments": stated["moments"] if stated else [],
        "at": instants,
        "stated": stated is not None,
        "draft": stated["draft"] if stated else None,
    }
    if stated and stated.get("clip"):
        read["clip"] = stated["clip"]
    return read


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


def _by_attr(case: Case, entity_type: str, attr: str) -> dict[Any, dict[str, Any]]:
    """The entities of one type by one of their attributes, the first filed winning as
    `find_entity` has it, read in pages."""
    found: dict[Any, dict[str, Any]] = {}
    cursor: str | None = None
    while True:
        page = case.page_entities(limit=LOOKUP_BATCH, cursor=cursor, types=[entity_type])
        for entity in page.get("items", []):
            value = (entity.get("attrs") or {}).get(attr)
            if isinstance(value, str) and value:
                found.setdefault(value, entity)
        cursor = page.get("next_cursor")
        if not cursor:
            return found


class Lookup:
    """Each proof's entity by its spec and each place by its point, read in one pass
    the first time a row asks. `find_entity` scans every entity of the case, and the
    rows of a video with 150 proofs asked it 300 times. A point no place answers is
    asked of `place_at` itself, which also follows a place merged into another."""

    def __init__(self, case: Case) -> None:
        self.case = case
        self._proofs: dict[Any, dict[str, Any]] | None = None
        self._places: dict[Any, dict[str, Any]] | None = None

    def proof(self, rel: str) -> dict[str, Any] | None:
        if self._proofs is None:
            self._proofs = _by_attr(self.case, "proof", "spec")
        return self._proofs.get(rel)

    def place(self, lat: float, lon: float) -> dict[str, Any] | None:
        if self._places is None:
            self._places = _by_attr(self.case, "place", satellite_engine.COORD_KEY)
        found = self._places.get(satellite_engine.coord_key(lat, lon))
        return found if found is not None else satellite_engine.place_at(self.case, lat, lon)


def _points(lookup: Lookup, spec: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for point in satellite_engine.spec_points(spec):
        place = lookup.place(point["lat"], point["lon"])
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


def _text(value: Any) -> str | None:
    return value if isinstance(value, str) and value else None


def clip_file(case: Case, clip: Any) -> dict[str, Any] | None:
    """A scene's clip as a row gives it while its file is in the case: ``{path, start,
    end, size, title}``, the size and title as Media holds them. None once the file is
    gone, sent to the Trash or never filed: the clip comes back with it."""
    read = read_clip(clip)
    if read is None or _existing(case, read["path"]) is None:
        return None
    items = case.media_items_by_paths([read["path"]])
    if not items:
        return None
    size = items[0].get("size")
    return {
        **read,
        "size": size if isinstance(size, int) and not isinstance(size, bool) else None,
        "title": file_title(items[0], read["path"]),
    }


def _proof_row(lookup: Lookup, name: str, spec: dict[str, Any], scene: dict[str, Any]) -> dict[str, Any]:
    case = lookup.case
    proof = lookup.proof(layout.proof_spec_rel(name))
    attrs = (proof or {}).get("attrs") or {}
    zone = attrs.get("when_zone") or spec.get("whenZone")
    # The spec's thumbnail, else the one its entity carries: a proof saved before the
    # spec recorded it still has one there. Never the export itself, which a strip of
    # thirty slides would load whole, and never one made here, since this is a read.
    thumb = _existing(case, _text(spec.get("thumb"))) or _existing(case, _text(attrs.get("thumb")))
    points = _points(lookup, spec)
    first = points[0] if points else None
    state, abandoned = proof_state(states_place(spec), attrs)
    # the clip cut for its post, while its file is in the case, with its size
    clip = clip_file(case, scene.get("clip"))
    scene = {key: value for key, value in scene.items() if key != "clip"} | ({"clip": clip} if clip else {})
    return {
        "kind": "proof",
        "proof": name,
        "proof_id": proof["id"] if proof else None,
        "title": spec.get("title") or name,
        **scene,
        "points": points,
        # where its conclusion stands as the case knows it, for a proof's label
        "place": satellite_engine.place_words(lookup.place(first["lat"], first["lon"])) if first else "",
        # its point's plus code, which tells apart two places of one region
        "plus_code": geo_engine.plus_code(first["lat"], first["lon"]) if first else "",
        "state": state,
        "abandoned": abandoned,
        "png": _existing(case, layout.proof_export_rel(name)),
        "thumb": thumb,
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


#: The states of a scene still to prove (`engine/geolocate.py`); a proof is Proved
#: once it states a place.
TODO = "todo"
PROGRESS = "progress"
ABANDONED = "abandoned"
PROVED = "proved"


def states_place(spec: dict[str, Any]) -> bool:
    """Whether a proof states a place someone checked. A point the imagery proposed and
    nobody looked at (``proposed``, `satellite.spec_points`) says where to look, not
    where it is, so a proof holding only those is still being geolocated."""
    return any(not point.get("proposed") for point in satellite_engine.spec_points(spec))


def proof_state(located: bool, attrs: dict[str, Any]) -> tuple[str, dict[str, Any] | None]:
    """Where a proof stands: Proved once it states a place. Until then it is a scene
    still being geolocated, In progress, unless the analyst gave up on it: the word it
    was abandoned with lives on the proof's entity (`attrs.abandoned`), never in its
    spec, so a save from Geo Proof leaves it be."""
    if located:
        return PROVED, None
    abandoned = attrs.get("abandoned")
    if isinstance(abandoned, dict):
        return ABANDONED, abandoned
    return PROGRESS, None


def unplaced_proofs(
    case: Case, proofs: tuple[list[tuple[str, dict[str, Any]]], Origins]
) -> dict[str, list[dict[str, Any]]]:
    """The proofs made for a scene of a video that state no checked place yet, by video, in the
    shape the queue lists a scene in: what the To-do still counts as to geolocate. Only
    a proof that states its scene: an older proof traced to a video by its frames was
    never asked to be one of its places."""
    specs, origins = proofs
    lookup = Lookup(case)
    out: dict[str, list[dict[str, Any]]] = {}
    for name, spec in specs:
        if states_place(spec):
            continue
        scene = proof_scene(spec, origins)
        if scene is None or not scene["stated"]:
            continue
        attrs = (lookup.proof(layout.proof_spec_rel(name)) or {}).get("attrs") or {}
        state, abandoned = proof_state(False, attrs)
        first = scene["moments"][0] if scene["moments"] else {}
        out.setdefault(scene["video"], []).append({
            "kind": "proof",
            "id": f"proof:{name}",
            "proof": name,
            "video": scene["video"],
            # a name the app gave says nothing: the To-do shows its time instead
            "label": "" if layout.is_default_name(spec.get("title") or name, "proof") else str(spec.get("title") or name),
            # every moment, as a proof's row says them; the first also as a scene's, for its mark
            "moments": scene["moments"],
            "start": first.get("start"),
            "end": first.get("end"),
            "state": state,
            "abandoned": abandoned,
            "captures": [],
        })
    return out


def _captured(case: Case, paths: Any) -> list[str]:
    """The captures still in the case, in the order they were attached. One sent to
    the Trash stays listed in the work and comes back with its file."""
    wanted = [p for p in paths if isinstance(p, str) and p] if isinstance(paths, list) else []
    if not wanted:
        return []
    present = {item.get("path") for item in case.media_items_by_paths(wanted)}
    return [p for p in wanted if p in present]


def file_title(item: dict[str, Any] | None, path: str) -> str:
    """What the case calls a file: the title Media gives it, else its file name without
    the extension (`clip.mp4` reads `clip`)."""
    title = (item or {}).get("title")
    if isinstance(title, str) and title.strip():
        return title.strip()
    name = str((item or {}).get("filename") or "") or path.rsplit("/", 1)[-1]
    return PurePosixPath(name).stem or name


def strip_times(spec: dict[str, Any] | None, video: str) -> list[float]:
    """The instants of the frames in a video's Inspect strip, filed to the case or not."""
    return [
        time for frame in (spec or {}).get("frames") or []
        if isinstance(frame, dict) and frame.get("path", video) == video and (time := _seconds(frame.get("time"))) is not None
    ]


class Footage:
    """What a video gives its scenes to prove: the frames of its Inspect strip and its
    collages, by their instants (`strip_times`, `collage_times`).

    A scene counts each one that falls in one of its moments, by the rule Inspect's dots
    use (`frame_in_moment`) at a thirtieth of a second, the frame Inspect's player counts
    while it has not read the clip: the clip itself is never probed for a count. A scene
    about the whole video counts every one, and a collage that kept no instant counts
    only there."""

    def __init__(self, frames: list[float] | None = None, collages: list[list[float]] | None = None) -> None:
        self.frames = frames or []
        self.collages = collages or []

    def count(self, moments: Sequence[Mapping[str, Any]]) -> int:
        if not moments:
            return len(self.frames) + len(self.collages)

        def held(time: float) -> bool:
            return any(frame_in_moment(time, m["start"], m["end"], 1 / DEFAULT_FPS) for m in moments)

        return sum(1 for time in self.frames if held(time)) + sum(1 for times in self.collages if any(map(held, times)))


def video_footage(case: Case, video: str) -> Footage:
    """What one video gives its scenes, its work and the collage documents read for it."""
    spec = (inspectwork.find_work(case, video) or {}).get("spec") or {}
    return Footage(strip_times(spec, video), collage_times(case).get(video, []))


def draft_row(
    case: Case, video: str, draft: dict[str, Any], file_kind: str = "video", footage: Footage | None = None
) -> dict[str, Any]:
    """A scene still to prove as Inspect and the queue read it: its time, its label, its
    state, the captures it gathered that are still in the case, and why it was left.
    ``file_kind`` is the file's (`video` or `image`): an image is only ever marked whole.

    ``footage`` is how much its file gives it: the frames and the collages of its video
    in it (`Footage`, read for the video when not given), or 1 for a picture, which is
    the picture itself. With ``len(captures)``, what the map gave it, the two counts say
    at a glance whether the scene is ready to prove."""
    captures = _captured(case, draft.get("captures"))
    abandoned = draft.get("abandoned") if isinstance(draft.get("abandoned"), dict) else None
    start = _seconds(draft.get("start"))
    end = _seconds(draft.get("end")) if start is not None else None
    # a scene of one place holding several moments: the first is its start and end
    moments = inspectwork.scene_moments(draft)
    time = inspectwork.scene_time(moments) if len(moments) > 1 else {"start": start, "end": end}
    if file_kind == "image":
        given = 1
    else:
        given = (footage if footage is not None else video_footage(case, video)).count(moments)
    return {
        "kind": "draft",
        "video": video,
        "id": draft["id"],
        **time,
        "label": str(draft.get("label") or ""),
        "state": ABANDONED if abandoned else PROGRESS if captures else TODO,
        "captures": captures,
        "footage": given,
        "abandoned": abandoned,
        "file_kind": file_kind,
    }


def laid_out_by(specs: list[tuple[str, dict[str, Any]]], path: str) -> list[tuple[str, dict[str, Any]]]:
    """The proofs laying a file out as a panel: what proves an image marked to geolocate."""
    return [(name, spec) for name, spec in specs if path in _panel_sources(spec)]


def _drafts_of(case: Case, path: str, works: dict[str, dict[str, Any]] | None) -> list[dict[str, Any]]:
    """A file's scenes to prove, from the works already read for a pass over many files."""
    spec = works.get(path) if works is not None else (inspectwork.find_work(case, path) or {}).get("spec")
    return [d for d in (spec or {}).get("scenes") or [] if isinstance(d, dict)]


def _image_scenes(
    case: Case,
    image: str,
    entity: dict[str, Any],
    specs: list[tuple[str, dict[str, Any]]],
    works: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """A picture's scenes: what the analyst marked to geolocate in it, the whole of it as
    the app marks it, all proved by any proof that lays the picture out, which then
    lists in their place. A picture has no time to order them by."""
    laid = laid_out_by(specs, image)
    lookup = Lookup(case)
    scenes = [_proof_row(lookup, name, spec, {"video": image, "moments": [], "at": []}) for name, spec in laid]
    drafts = [d for d in _drafts_of(case, image, works) if isinstance(d.get("id"), str)]
    hidden = sorted(d["id"] for d in drafts) if laid else []
    if not laid:
        scenes += [draft_row(case, image, d, "image") for d in drafts]
    return {"video": image, "video_id": entity["id"], "scenes": scenes, "used": {}, "taken": hidden}


def scene_places(
    case: Case,
    videos: list[str],
    proofs: tuple[list[tuple[str, dict[str, Any]]], Origins],
    works: dict[str, dict[str, Any]],
) -> dict[tuple[str, str], int]:
    """Each draft's place among its video's scenes, proofs included, in the order
    `video_scenes` lists them, read from their times alone: what the queue colours a
    scene by, without building every proof's row. A proof's place is under
    ``proof:<name>``, the id the queue lists one that states no place yet by."""
    specs, origins = proofs
    rows: dict[str, list[dict[str, Any]]] = {video: [] for video in videos}
    taken: set[str] = set()
    for name, spec in specs:
        taken |= cited_drafts(stated_scene(spec))
        scene = proof_scene(spec, origins)
        if scene is not None and scene["video"] in rows:
            rows[scene["video"]].append({"kind": "proof", "name": name, **scene})
    for video in videos:
        for draft in _drafts_of(case, video, works):
            if not isinstance(draft.get("id"), str) or draft["id"] in taken:
                continue
            start, end = _seconds(draft.get("start")), _seconds(draft.get("end"))
            whole = draft.get("start") is None and draft.get("end") is None
            if (start is None and not whole) or (start is not None and end is not None and end <= start):
                continue
            rows[video].append({"kind": "draft", "id": draft["id"], "start": start, "end": end if start is not None else None})
    places: dict[tuple[str, str], int] = {}
    for video, listed in rows.items():
        listed.sort(key=_order)
        for at, row in enumerate(listed):
            # a proof by the id the queue lists it under (`unplaced_proofs`)
            places[(video, row["id"] if row["kind"] == "draft" else f"proof:{row['name']}")] = at
    return places


def read_proofs(case: Case) -> tuple[list[tuple[str, dict[str, Any]]], Origins]:
    """Every proof's spec and where its frames were cut, read once for several videos."""
    specs = proof_specs(case)
    return specs, frame_origins(case, [src for _name, spec in specs for src in _panel_sources(spec)])


def proof_slides(case: Case, specs: list[tuple[str, dict[str, Any]]]) -> dict[str, dict[str, Any]]:
    """Where each proof resting on a video of the case stands among that video's scenes,
    for a list of every proof: the video and what the case calls it (``video_title``,
    `file_title`), its place among the video's scenes, drafts
    included (``order``, the colour Inspect's bar gives it), and its place among the
    video's proofs as Geo Proof's strip lays them out (``slide`` of ``slides``: clip
    order, the abandoned ones last), and whether a video thread posts it (``postable``:
    it states a place). A proof on photos is left out.

    One pass for the whole list: the frames looked up in batches, the works and the
    proofs' entities read once, so the list of 300 proofs does not ask per row.
    """
    origins = frame_origins(case, [src for _name, spec in specs for src in _panel_sources(spec)])
    scenes = {name: scene for name, spec in specs if (scene := proof_scene(spec, origins)) is not None}
    wanted = sorted({scene["video"] for scene in scenes.values()})
    # each video by what the case calls it: its title in Media, else its file name
    videos: dict[str, str] = {}
    for at in range(0, len(wanted), LOOKUP_BATCH):
        videos.update(
            (item["path"], file_title(item, item["path"]))
            for item in case.media_items_by_paths(wanted[at : at + LOOKUP_BATCH])
            if item.get("kind") == "video" and isinstance(item.get("path"), str)
        )
    if not videos:
        return {}
    places = scene_places(case, sorted(videos), (specs, origins), inspectwork.subject_specs(case))
    entities = _by_attr(case, "proof", "spec")
    by_video: dict[str, list[tuple[bool, tuple[float, float], str, bool]]] = {}
    for name, spec in specs:
        scene = scenes.get(name)
        if scene is None or scene["video"] not in videos:
            continue
        attrs = (entities.get(layout.proof_spec_rel(name)) or {}).get("attrs") or {}
        state, _abandoned = proof_state(states_place(spec), attrs)
        by_video.setdefault(scene["video"], []).append(
            (state == ABANDONED, _order({"kind": "proof", **scene}), name, state == PROVED)
        )
    out: dict[str, dict[str, Any]] = {}
    for video, rows in by_video.items():
        rows.sort(key=lambda row: (row[0], row[1]))
        for at, (_left, _when, name, placed) in enumerate(rows):
            out[name] = {
                "video": video,
                "video_title": videos[video],
                "order": places.get((video, f"proof:{name}"), 0),
                "slide": at + 1,
                "slides": len(rows),
                "postable": placed,
            }
    return out


def scenes_cited(case: Case, rel: str) -> tuple[str | None, set[str]]:
    """The video a proof rests on and the scenes to prove it cites, by its spec's path:
    what goes with it when its delete takes its scene too (`api/proofs.delete_proof`)."""
    try:
        spec = _read_proof(case.resolve_inside(rel))
    except (UnknownProof, CaseError):
        return None, set()
    video, _moments = star_video(case, spec)
    return video, cited_drafts(stated_scene(spec))


def video_scenes(
    case: Case,
    video: str,
    proofs: tuple[list[tuple[str, dict[str, Any]]], Origins] | None = None,
    works: dict[str, dict[str, Any]] | None = None,
    collages: list[list[float]] | None = None,
) -> dict[str, Any]:
    """The scenes of one video, in the order they come in the clip, or of one picture
    (`_image_scenes`): its whole, marked to geolocate, and the proofs laying it out.

    Proofs first resolve to the video they rest on; the drafts still waiting in the
    video's Inspect work join them, minus any a proof in the case has taken up, even
    one whose ★ has since moved to another video. ``taken`` names those, so Inspect
    hides them in the work it holds too.

    ``used`` names, for each frame of this video a proof lays out, the proofs that
    do, whichever video each of them is about: Inspect says so on the frame.

    ``collages`` are the instants of the video's collages when the caller read them
    (`video_collages`), counted with its frames in each scene still to prove.
    """
    entity = case.find_entity(attr="path", value=video)
    if entity is None or entity.get("type") != "media":
        raise CaseError("that file is not in the case")
    items = case.media_items_by_paths([video])
    kind = items[0].get("kind") if items else None
    if kind not in ("video", "image"):
        raise CaseError("only a video or a picture has scenes")
    specs, origins = proofs if proofs is not None else read_proofs(case)
    if kind == "image":
        return _image_scenes(case, video, entity, specs, works)

    scenes: list[dict[str, Any]] = []
    taken: set[str] = set()
    used: dict[str, list[dict[str, str]]] = {}
    lookup = Lookup(case)
    for name, spec in specs:
        for src in dict.fromkeys(_panel_sources(spec)):
            if src in origins and origins[src][0] == video:
                used.setdefault(src, []).append({"proof": name, "title": spec.get("title") or name})
        taken |= cited_drafts(stated_scene(spec))
        scene = proof_scene(spec, origins)
        if scene is None:
            continue
        if scene["video"] == video:
            scenes.append(_proof_row(lookup, name, spec, scene))

    work = works.get(video) if works is not None else (inspectwork.find_work(case, video) or {}).get("spec")
    drafts = [d for d in (work or {}).get("scenes") or [] if isinstance(d, dict)]
    hidden = sorted(taken & {d.get("id") for d in drafts if isinstance(d.get("id"), str)})
    footage: Footage | None = None
    for draft in drafts:
        if draft.get("id") in taken:
            continue
        start, end = _seconds(draft.get("start")), _seconds(draft.get("end"))
        whole = draft.get("start") is None and draft.get("end") is None
        if (start is None and not whole) or (start is not None and end is not None and end <= start):
            continue
        if footage is None:
            footage = Footage(strip_times(work, video), collages if collages is not None else collage_times(case).get(video, []))
        scenes.append(draft_row(case, video, draft, footage=footage))
    scenes.sort(key=_order)
    return {"video": video, "video_id": entity["id"], "scenes": scenes, "used": used, "taken": hidden}


def _case_video(case: Case, path: str) -> bool:
    entity = case.find_entity(attr="path", value=path)
    if entity is None or entity.get("type") != "media":
        return False
    items = case.media_items_by_paths([path])
    return bool(items) and items[0].get("kind") == "video"


def _a_case_video(case: Case, path: str) -> None:
    """Refuse a file the case does not hold, then one that is not a video."""
    entity = case.find_entity(attr="path", value=path)
    if entity is None or entity.get("type") != "media":
        raise CaseError("that file is not in the case")
    if not _case_video(case, path):
        raise BadScene("only a video has scenes in a clip")


def slides(case: Case, video: str) -> list[dict[str, Any]]:
    """The proofs about one video in clip order, as `video_scenes` lists them: Geo
    Proof's slides of that video, without the scenes still to prove."""
    _a_case_video(case, video)
    return [row for row in video_scenes(case, video)["scenes"] if row["kind"] == "proof"]


class UnknownDraft(LookupError):
    """No scene still to prove by that id in the video's Inspect work."""


#: The rate a frame's length is counted at while the clip's is unknown
#: (`lib/inspectPlayer.js` `DEFAULT_FPS`).
DEFAULT_FPS = 30.0


def frame_in_moment(time: float, start: float, end: float | None, frame: float) -> bool:
    """Whether the frame cut at ``time``, ``frame`` seconds long, falls in a moment:
    the rule of `lib/sceneFrames.frameInMoment`, so Geo Proof offers the frames
    Inspect's dots put in that scene. Each boundary gives half a frame, since the time
    a frame keeps is read off the file and the one a scene keeps is counted by the
    player. A frame is in a passage when its middle is, and shows an instant when it
    starts within half a frame of it."""
    half = frame / 2
    if end is not None and end > start:
        return start <= time + half < end
    return time - half <= start < time + half


def _frame_length(case: Case, video: str) -> float:
    """One frame of the clip in seconds, as Inspect's player counts it."""
    try:
        fps = inspect_engine.probe(case, video).get("fps")
    except (OSError, ValueError, CaseError, subprocess.SubprocessError):
        fps = None
    rate = fps if isinstance(fps, (int, float)) and math.isfinite(fps) and fps > 0 else DEFAULT_FPS
    return 1 / rate


#: What Inspect keeps on a frame that changes the picture it saves (``buildFrameOps``).
FRAME_EDITS = ("sourceOps", "rotation", "adjust", "crop")


def draft_frames(case: Case, video: str, draft: str) -> list[dict[str, Any]]:
    """The frames Inspect cut inside one scene still to prove, in clip order, each
    with the picture it was saved to the case as, and that picture's thumbnail.

    What Geo Proof offers to make that scene a slide. A frame never saved, or whose
    picture has left the case, has no ``path``: the composer files it first, as
    Inspect does, through the ``edits`` Inspect keeps for it (crop, turn, sliders),
    so the picture comes out as Inspect would have saved it. A scene about the whole
    video holds every frame, and one holding several moments the frames inside any of
    them. Read only: nothing is filed, and no thumbnail is made.
    """
    _a_case_video(case, video)
    work = (inspectwork.find_work(case, video) or {}).get("spec") or {}
    scene = next(
        (d for d in work.get("scenes") or [] if isinstance(d, dict) and d.get("id") == draft), None
    )
    if scene is None:
        raise UnknownDraft("no such scene to geolocate in that video")
    moments = inspectwork.scene_moments(scene)
    frames = [
        (frame, time)
        for frame in work.get("frames") or []
        if isinstance(frame, dict)
        and isinstance(frame.get("id"), str)
        and frame.get("path", video) == video
        and (time := _seconds(frame.get("time"))) is not None
    ]
    if moments:
        length = _frame_length(case, video)
        frames = [
            (frame, time) for frame, time in frames
            if any(frame_in_moment(time, m["start"], m["end"], length) for m in moments)
        ]
    frames.sort(key=lambda pair: pair[1])

    def filed(frame: dict[str, Any]) -> str | None:
        record = frame.get("filed")
        return _text(record.get("path")) if isinstance(record, dict) else None

    wanted = list(dict.fromkeys(p for frame, _time in frames if (p := filed(frame))))
    held: dict[str, dict[str, Any]] = {}
    for at in range(0, len(wanted), LOOKUP_BATCH):
        held.update((item["path"], item) for item in case.media_items_by_paths(wanted[at : at + LOOKUP_BATCH]))
    out = []
    for frame, time in frames:
        path = filed(frame)
        item = held.get(path) if path else None
        out.append({
            "id": frame["id"],
            "time": time,
            "path": path if item is not None else None,
            "thumb": _existing(case, _text(item.get("thumbnail"))) if item is not None else None,
            "edits": {key: frame[key] for key in FRAME_EDITS if frame.get(key) is not None},
        })
    return out


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
) -> tuple[str, str | None, Origins]:
    """The video a proof's time is in: the one asked for, else the one it states while
    the case holds it, else the one its frames were cut from, else the one its panels
    are tied to (`panel_ties`). With the traced one, and the frames' origins.

    A video asked for is one of the case that a panel was cut from or is tied to, or the
    one the proof already states: the ★ moves between the videos the proof shows, never
    to a clip it has nothing from.
    """
    origins = frame_origins(case, _panel_sources(spec))
    stated = stated_scene(spec)
    tied: list[str] | None = None

    def tied_to() -> list[str]:
        nonlocal tied
        if tied is None:
            tied = tied_videos(case, spec)
        return tied

    # a proof whose panels were made from the footage without being cut from it reads
    # back to the first video they are tied to, as one cut from it reads back to its frames
    traced = traced_video(spec, origins) or next(iter(tied_to()), None)
    if wanted is not None:
        cut_from = {origin for origin, _time in origins.values()}
        known = wanted in cut_from or wanted == (stated or {}).get("video") or wanted in tied_to()
        if not _case_video(case, wanted) or not known:
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
    case: Case, name: str, moments: Any, video: Any = None, draft: Any = None, traced: bool = False
) -> dict[str, Any]:
    """Say when in its video a proof happens, and answer with its scene as now read.

    ``moments`` are the instants and passages the place shows in; none is the whole
    video, stated as such. Only ``spec["scene"]`` is written: the video it names, the
    moments, and the draft it came from. The video is the one asked for, else the one
    the proof states, else the one its frames were cut from. ``draft`` is the Inspect
    scene the proof takes up, given once: a proof that already took up another one
    refuses it. The clip cut for its post stays while the video does, and is let go
    when the ★ moves.

    ``traced`` takes the proof back to the frames it was built on, the Undo of its
    first time: no moments, and the scene it took up let go, which Inspect then lists
    again. A proof that ends up stating nothing its frames do not say keeps no scene at
    all, exactly the proof it was before.
    """
    stated_moments = _stated_moments(moments)
    wanted = _wanted_video(video)
    wanted_draft = _wanted_draft(draft)
    if traced and (stated_moments or wanted_draft is not None):
        raise BadScene("a proof taken back to its frames states no time and takes up no scene")

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
        target, traced_video, origins = _scene_video(case, spec, wanted)
        stated = stated_scene(spec)
        held = stated["draft"] if stated else None
        if wanted_draft is not None and held not in (None, wanted_draft):
            raise CaseError("this proof already takes up another scene")
        draft_id = None if traced else wanted_draft or held
        gave = (stated or {}).get("gave")
        # the clip cut for the post stays while the proof is about the video it came from
        clip = (stated or {}).get("clip") if (stated or {}).get("video") == target else None
        if traced and not gave and not clip and target == traced_video:
            spec.pop("scene", None)
        else:
            spec["scene"] = {
                "video": target, "moments": stated_moments, "draft": draft_id,
                **({"gave": gave} if gave else {}), **({"clip": clip} if clip else {}),
            }
        media_engine.write_json_atomic(path, spec)
    # It names a video either way: the one stated, else the one its frames were cut from.
    return {"proof": name, **(proof_scene(spec, origins) or {})}


def _same_moment(a: Mapping[str, Any], b: Mapping[str, Any]) -> bool:
    if abs(a["start"] - b["start"]) >= 1e-6:
        return False
    return (a["end"] is None and b["end"] is None) or (
        a["end"] is not None and b["end"] is not None and abs(a["end"] - b["end"]) < 1e-6
    )


def give_back(case: Case, proof: dict[str, Any], leaving: set[str]) -> list[str]:
    """Give a proof's scene back to its video's Inspect work as the proof goes to the
    Trash, and answer with the ids of the scenes added.

    A timecode is knowledge about the video, not only the proof's, so it must not leave
    with it: one scene to geolocate holding every moment the proof states, since they
    show one place, or about the whole video when it states none, named with the
    proof's title. A moment a scene of the work already holds is not given twice. A
    proof that took a scene up, or already gave one back, adds nothing:
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
        # a moment a scene of the work already holds is not given twice
        held = [m for d in _drafts_of(case, video, None) for m in inspectwork.scene_moments(d)]
        fresh = [m for m in moments if not any(_same_moment(m, h) for h in held)]
        if moments and not fresh:
            return []
        # moments a proof read leniently may clash: a scene holds them the way a join does
        time = inspectwork.scene_time(inspectwork.join_moments(fresh)[: inspectwork.MAX_SCENE_MOMENTS])
        added = inspectwork.add_scenes(case, video, [{**time, "label": title}])
        if not added:
            return []
        clip = (stated or {}).get("clip") if (stated or {}).get("video") == video else None
        spec["scene"] = {
            "video": video,
            "moments": moments,
            "draft": stated["draft"] if stated else None,
            "gave": added,
            **({"clip": clip} if clip else {}),
        }
        media_engine.write_json_atomic(path, spec)
        return added
