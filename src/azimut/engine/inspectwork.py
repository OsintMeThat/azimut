"""Inspect's saved work, and the collages laid out from it.

Two artifacts with two lifetimes.

**Work** belongs to one file: the frames cut from a video or an image and the edits
over them. It is saved as it is made, one spec per file, and it depends on that file
(ONTOLOGY §3), so deleting the file deletes the work. A file never has more than one,
which is what lets opening a file simply reopen what was done to it.

**A collage** lays out pieces from any number of files. Each piece is a recipe (path,
instant, ops) frozen when it was placed, so a collage is a document of its own: a lost
source leaves a gap in the layout rather than voiding it, and the picture it exports is
media.

Before 0.3.1 both lived in a "session", saved by hand under a name, as many per file as
the analyst liked, with the collages inside. `normalize` turns that shape into this one
and is the migration for it: the sessions of one file merge into its work, every
collage becomes a collage document, and nothing the analyst typed is dropped. It is
idempotent and restartable, because it runs on open and again after a restore from the
Trash, which can bring an old session back into a case that has moved on. The merge
cannot be taken back, so every session it rewrites is first copied, byte for byte, to
`.inspect/.v1/`.
"""

from __future__ import annotations

import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any

from .. import layout
from ..workspace import CaseError
from . import links as link_engine
from . import media as media_engine

if TYPE_CHECKING:
    from ..workspace import Case

#: The spec shapes. A work spec is stamped `azimut_inspect: 2`; version 1 is the
#: pre-0.3.1 session, which only `normalize` still reads.
WORK_VERSION = 2
LEGACY_VERSION = 1
COLLAGE_VERSION = 1

#: Bounds on what a save may write. A work or a collage is recipes, never pixels, so
#: these are far above anything a real one reaches and only stop a runaway client.
MAX_SPEC_BYTES = 2_000_000
MAX_FRAMES = 500
MAX_PIECES = 200

WORK_TYPE = "inspect-session"
COLLAGE_TYPE = "collage"
PRODUCER = "inspect"

#: What a frame and a piece hold. Anything else a client sends is dropped rather
#: than stored, so the format on disk stays the one documented here.
_FRAME_KEYS = (
    "id", "path", "time", "adjust", "crop", "sourceOps", "rotation", "w", "h", "filed",
)
_PIECE_KEYS = ("id", "frameId", "save", "w", "h", "quad", "frameOps", "crop")
_RIGHT_ANGLES = (-180, -90, 0, 90, 180)

#: Names the app hands out before the analyst types one. They describe nothing, so a
#: merge prefers any typed name over them.
_DEFAULT_SESSION = re.compile(r"^Inspect \d+$")
_DEFAULT_COLLAGE = re.compile(r"^Collage \d+$")


class NameTaken(CaseError):
    """A rename onto a name another collage already holds."""


def _now() -> str:
    """UTC, to the millisecond: a merge keeps the most recently saved work, and two
    saves inside one second must still be told apart."""
    now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


def _read(path: Path) -> dict[str, Any] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def _write(path: Path, data: dict[str, Any]) -> None:
    media_engine.write_json_atomic(path, data)


def _check_size(spec: dict[str, Any]) -> None:
    if len(json.dumps(spec, ensure_ascii=False)) > MAX_SPEC_BYTES:
        raise CaseError("that is too large to save")


def _free_title(taken: set[str], title: str, fallback: str) -> str:
    """`title` as a filename stem, numbered past whatever `taken` already holds.

    `taken` is casefolded: two stems differing only by case are one file on Windows
    and macOS.
    """
    base = layout.slugify(title, fallback)
    if base.casefold() not in taken:
        return base
    n = 2
    while True:
        suffix = f" {n}"
        candidate = layout.slugify(f"{base[: layout.MAX_SLUG - len(suffix)]}{suffix}", fallback)
        if candidate.casefold() not in taken:
            return candidate
        n += 1


def _stems(case: "Case", directory: str) -> set[str]:
    folder = case.tool_root / directory
    if not folder.is_dir():
        return set()
    return {path.stem.casefold() for path in folder.glob("*.json")}


def _trashed_stems(case: "Case", directory: str) -> set[str]:
    """Names in `directory` that a delete moved into the Trash.

    A new artifact must not take one: the restore would find its path occupied and
    refuse, and clearing a file's work then starting over is exactly when someone
    wants the old frames back.
    """
    prefix = f"{directory}/"
    out = set()
    for head in case.list_trash():
        group = case.get_trash_group(head["id"]) or {}
        for rel in (group.get("payload") or {}).get("files") or []:
            rel = str(rel)
            if rel.startswith(prefix) and rel.endswith(".json") and "/" not in rel[len(prefix):]:
                out.add(Path(rel).stem.casefold())
    return out


def _taken(case: "Case", directory: str) -> set[str]:
    return _stems(case, directory) | _trashed_stems(case, directory)


def _describes_nothing(name: str, file_label: str) -> bool:
    """Whether a session's name is one the app made up rather than the analyst.

    "Inspect 3" was the old default; a work is born under its file's name, numbered
    when that name was taken. Neither tells anyone anything the file does not. The
    name is the file's label as `_free_title` wrote it: a long label is cut to fit
    a filename and a character Windows forbids is replaced.
    """
    if _DEFAULT_SESSION.match(name):
        return True
    if not file_label:
        return False
    base = layout.slugify(file_label, "Inspect")
    if name in (file_label, base):
        return True
    numbered = re.fullmatch(r".+( \d+)", name)
    if numbered is None:
        return False
    suffix = numbered.group(1)
    cut = layout.slugify(f"{base[: layout.MAX_SLUG - len(suffix)]}{suffix}", "Inspect")
    return name in (f"{file_label}{suffix}", cut)


# -- work ---------------------------------------------------------------------


def _work_specs(case: "Case") -> list[tuple[str, dict[str, Any]]]:
    """Every readable Inspect spec, current or legacy, as (case path, spec)."""
    folder = case.tool_root / layout.INSPECT_DIR
    if not folder.is_dir():
        return []
    out = []
    for path in sorted(folder.glob("*.json")):
        spec = _read(path)
        if spec is None or spec.get("azimut_inspect") not in (WORK_VERSION, LEGACY_VERSION):
            continue
        out.append((layout.session_rel(path.stem), spec))
    return out


def _subject(spec: dict[str, Any]) -> str | None:
    source = spec.get("source")
    path = source.get("path") if isinstance(source, dict) else None
    return path if isinstance(path, str) and path else None


def _group(case: "Case", subject: str) -> list[tuple[str, dict[str, Any]]]:
    return [(rel, spec) for rel, spec in _work_specs(case) if _subject(spec) == subject]


def _work_row(rel: str, spec: dict[str, Any]) -> dict[str, Any]:
    source = spec.get("source") or {}
    # The name is the filename stem, which a rename from Details moves without
    # rewriting the spec, so the stem is what is true.
    return {
        "name": Path(rel).stem,
        "title": Path(rel).stem,
        "source": source.get("path"),
        "kind": source.get("kind"),
        "frames": len(spec.get("frames") or []),
        "updated_at": spec.get("updated_at"),
    }


def list_works(case: "Case") -> list[dict[str, Any]]:
    """One row per file that has work, most recently touched first."""
    rows = [
        _work_row(rel, spec)
        for rel, spec in _work_specs(case)
        if spec.get("azimut_inspect") == WORK_VERSION and _subject(spec)
    ]
    rows.sort(key=lambda row: row.get("updated_at") or "", reverse=True)
    return rows


def _answer(rel: str, spec: dict[str, Any]) -> dict[str, Any]:
    return {"name": Path(rel).stem, "title": Path(rel).stem, "spec": spec}


def find_work(case: "Case", subject: str) -> dict[str, Any] | None:
    """The work saved for one file, or None when nothing was done to it yet."""
    with case.lock:
        found = _settle(case, subject)
    return _answer(*found) if found else None


def load_work(case: "Case", name: str) -> dict[str, Any] | None:
    """The work saved under one name: how the sidebar reopens it."""
    rel = layout.session_rel(layout.slugify(name, "Inspect"))
    spec = _read(case.resolve_inside(rel))
    if spec is None or spec.get("azimut_inspect") != WORK_VERSION:
        return None
    return _answer(rel, spec)


def _settle(case: "Case", subject: str) -> tuple[str, dict[str, Any]] | None:
    """The one current spec for a file, merging any others found beside it.

    There should never be two, but a restore from the Trash can bring back an older
    work, or a pre-0.3.1 session, next to the one the analyst has been adding to since.
    """
    group = _group(case, subject)
    if not group:
        return None
    if len(group) == 1 and group[0][1].get("azimut_inspect") == WORK_VERSION:
        return group[0]
    return _merge_subject(case, subject, group, _migrated_collages(case))


def _subject_entity(case: "Case", subject: str) -> dict[str, Any]:
    entity = case.find_entity(attr="path", value=subject)
    if entity is None or entity.get("type") not in ("media", "capture"):
        raise CaseError("that file is not in the case")
    item = media_engine.read_item(case, subject) or {}
    kind = item.get("kind") or (entity.get("attrs") or {}).get("kind")
    if kind not in ("image", "video"):
        raise CaseError("only images and videos can be inspected")
    return {**entity, "kind": kind}


def _pick(value: dict[str, Any], keys: tuple[str, ...]) -> dict[str, Any]:
    return {key: value[key] for key in keys if key in value}


def _clean_frames(frames: Any, subject: str) -> list[dict[str, Any]]:
    if not isinstance(frames, list):
        raise CaseError("frames must be a list")
    if len(frames) > MAX_FRAMES:
        raise CaseError(f"a file holds at most {MAX_FRAMES} frames")
    out = []
    for frame in frames:
        if not isinstance(frame, dict) or not isinstance(frame.get("id"), str):
            raise CaseError("every frame needs an id")
        # Every frame is cut from the file the work belongs to. One naming another
        # file would be work that outlives the file it silently depends on.
        if frame.get("path") != subject:
            raise CaseError("a frame must come from the file it is saved with")
        out.append(_pick(frame, _FRAME_KEYS))
    return out


def save_work(case: "Case", subject: str, spec: dict[str, Any]) -> dict[str, Any]:
    """Write one file's work, filing its entity the first time.

    The first save is named after the file, numbered past any work already holding
    that name. Later saves keep whatever name the entity carries, including one the
    analyst gave it from Details.
    """
    if not isinstance(spec, dict):
        raise CaseError("the work must be an object")
    _check_size(spec)
    frames = _clean_frames(spec.get("frames", []), subject)
    rotation = spec.get("videoRotation", 0)
    if rotation not in _RIGHT_ANGLES:
        raise CaseError("video rotation must be a right angle")
    adjust = spec.get("videoAdjust") or {}
    if not isinstance(adjust, dict):
        raise CaseError("video adjustments must be an object")

    with case.lock:
        entity = _subject_entity(case, subject)
        found = _settle(case, subject)
        if found:
            rel, previous = found
            title = Path(rel).stem
            created = previous.get("created_at") or _now()
        else:
            label = str(entity.get("label") or Path(subject).stem)
            title = _free_title(_taken(case, layout.INSPECT_DIR), label, "Inspect")
            rel = layout.session_rel(title)
            created = _now()
        active = spec.get("activeFrameId")
        written = {
            "azimut_inspect": WORK_VERSION,
            "title": title,
            "created_at": created,
            "updated_at": _now(),
            "source": {"path": subject, "kind": entity["kind"]},
            "videoAdjust": adjust,
            "videoRotation": rotation,
            "videoFiled": spec.get("videoFiled") if isinstance(spec.get("videoFiled"), dict) else None,
            "frames": frames,
            "activeFrameId": active if any(f["id"] == active for f in frames) else None,
        }
        if found and previous.get("merged_from"):
            written["merged_from"] = previous["merged_from"]
        case.subdir(layout.INSPECT_DIR)
        _write(case.resolve_inside(rel), written)
        filed = case.find_entity(attr="spec", value=rel)
        if filed is None:
            filed = case.add_entity(WORK_TYPE, title, attrs={"spec": rel}, by=PRODUCER)
        link_engine.sync(case, filed["id"], link_engine.DEPENDS_ON, [subject], by=PRODUCER)
    return {"name": Path(rel).stem, "title": title}


def follow_file_rename(case: "Case", subject: str, old_labels: list[str], label: str) -> None:
    """Carry a work named after its file over to the file's new name.

    A name the analyst typed stays as it is. Replayed by an interrupted media
    rename, so a second run finds the name already moved and does nothing.
    """
    with case.lock:
        found = _settle(case, subject)
        if not found:
            return
        rel = found[0]
        entity = case.find_entity(attr="spec", value=rel)
        if entity is None:
            return
        current = str(entity.get("label") or Path(rel).stem)
        if not any(_describes_nothing(current, old) for old in old_labels if old):
            return
        stem = Path(rel).stem.casefold()
        wanted = _free_title(_taken(case, layout.INSPECT_DIR) - {stem}, label, "Inspect")
        if wanted != current:
            case.update_entity(entity["id"], {"label": wanted})


def work_rel(case: "Case", subject: str) -> str | None:
    """Where one file's work is saved, for the route that deletes it."""
    with case.lock:
        found = _settle(case, subject)
    return found[0] if found else None


# -- collages -----------------------------------------------------------------


def _collage_specs(case: "Case") -> list[tuple[str, dict[str, Any]]]:
    folder = case.tool_root / layout.COLLAGE_DIR
    if not folder.is_dir():
        return []
    out = []
    for path in sorted(folder.glob("*.json")):
        spec = _read(path)
        if spec is not None and spec.get("azimut_collage") == COLLAGE_VERSION:
            out.append((layout.collage_rel(path.stem), spec))
    return out


def list_collages(case: "Case") -> list[dict[str, Any]]:
    rows = []
    for rel, spec in _collage_specs(case):
        rows.append({
            "name": Path(rel).stem,
            "title": Path(rel).stem,
            "pieces": len(spec.get("nodes") or []),
            "updated_at": spec.get("updated_at"),
        })
    rows.sort(key=lambda row: row.get("updated_at") or "", reverse=True)
    return rows


def load_collage(case: "Case", name: str) -> dict[str, Any] | None:
    rel = layout.collage_rel(layout.slugify(name, "Collage"))
    spec = _read(case.resolve_inside(rel))
    if spec is None or spec.get("azimut_collage") != COLLAGE_VERSION:
        return None
    return {"name": Path(rel).stem, "title": Path(rel).stem, "spec": spec}


def _clean_collage(spec: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(spec, dict):
        raise CaseError("the collage must be an object")
    _check_size(spec)
    nodes = spec.get("nodes", [])
    if not isinstance(nodes, list):
        raise CaseError("pieces must be a list")
    if len(nodes) > MAX_PIECES:
        raise CaseError(f"a collage holds at most {MAX_PIECES} pieces")
    pieces = []
    for node in nodes:
        save = node.get("save") if isinstance(node, dict) else None
        if not isinstance(save, dict) or not isinstance(save.get("path"), str):
            raise CaseError("every piece needs the file it was cut from")
        quad = node.get("quad")
        if not isinstance(quad, list) or len(quad) != 4:
            raise CaseError("every piece needs four corners")
        pieces.append(_pick(node, _PIECE_KEYS))
    out = {
        "width": spec.get("width"),
        "height": spec.get("height"),
        "background": spec.get("background"),
        "transparent": bool(spec.get("transparent", True)),
        "nodes": pieces,
    }
    if isinstance(spec.get("exported"), dict):
        out["exported"] = spec["exported"]
    return out


def save_collage(
    case: "Case", name: str | None, title: str, spec: dict[str, Any]
) -> dict[str, Any]:
    """Write a collage, filing it the first time and renaming it when asked.

    `name` is the stem the tool has it open under, absent for one never saved. A new
    collage takes the next free name; a rename lands on a free name or not at all,
    since two entities pointing at one file cannot be merged sensibly.
    """
    body = _clean_collage(spec)
    with case.lock:
        case.subdir(layout.COLLAGE_DIR)
        if name is None:
            final = _free_title(_taken(case, layout.COLLAGE_DIR), title, "Collage")
            old_rel = None
        else:
            current = layout.slugify(name, "Collage")
            final = layout.slugify(title, "Collage")
            old_rel = layout.collage_rel(current) if final != current else None
            taken = _stems(case, layout.COLLAGE_DIR)
            if old_rel and final.casefold() in taken and final.casefold() != current.casefold():
                raise NameTaken("another collage already uses that name")
        rel = layout.collage_rel(final)
        previous = _read(case.resolve_inside(old_rel or rel)) or {}
        written = {
            "azimut_collage": COLLAGE_VERSION,
            "title": final,
            "created_at": previous.get("created_at") or _now(),
            "updated_at": _now(),
            **body,
        }
        if previous.get("migrated_from"):
            written["migrated_from"] = previous["migrated_from"]
        if old_rel:
            # Written under the new name before the old file goes, so a crash in
            # between leaves the collage twice rather than not at all.
            _write(case.resolve_inside(rel), written)
            existing = case.find_entity(attr="spec", value=old_rel)
            if existing:
                case.update_entity(existing["id"], {"label": final, "attrs": {"spec": rel}})
            case.resolve_inside(old_rel).unlink(missing_ok=True)
        else:
            _write(case.resolve_inside(rel), written)
        if case.find_entity(attr="spec", value=rel) is None:
            case.add_entity(COLLAGE_TYPE, final, attrs={"spec": rel}, by=PRODUCER)
    return {"name": final, "title": final}


# -- 0.3.1: one work per file, collages on their own ------------------------------


def _migrated_collages(case: "Case") -> set[tuple[str, str]]:
    """The (session, collage) pairs already carried out, so a rerun makes none twice."""
    out = set()
    for _rel, spec in _collage_specs(case):
        marker = spec.get("migrated_from")
        if isinstance(marker, dict):
            out.add((str(marker.get("session")), str(marker.get("collage"))))
    return out


def _legacy_collages(spec: dict[str, Any]) -> list[dict[str, Any]]:
    """A pre-0.3.1 session's collages: an array, or once a single `collage`."""
    collages = spec.get("collages")
    if isinstance(collages, list):
        return [c for c in collages if isinstance(c, dict)]
    single = spec.get("collage")
    return [single] if isinstance(single, dict) else []


def _collage_title(session: str, collage: str, count: int) -> str | None:
    """What a collage carried out of a session is called, or None for "next free".

    A name the analyst typed on the collage wins. Otherwise the session's name is the
    best description of the collage there is, since a session was usually named for
    what it was building; with several collages it prefixes theirs.
    """
    if collage and not _DEFAULT_COLLAGE.match(collage):
        return collage
    if _DEFAULT_SESSION.match(session):
        return None
    return session if count == 1 else f"{session} · {collage or 'Collage'}"


def _keep_legacy(case: "Case", rel: str) -> None:
    """Copy a session aside, unchanged, before the merge rewrites or removes it.

    The first copy stands: a resumed merge must not overwrite it with a spec the
    interrupted run already changed.
    """
    source = case.resolve_inside(rel)
    target = case.resolve_inside(layout.legacy_session_rel(Path(rel).stem))
    if target.exists() or not source.is_file():
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)


def _extract_collages(
    case: "Case",
    rel: str,
    spec: dict[str, Any],
    session: str,
    folder: str | None,
    done: set[tuple[str, str]],
) -> None:
    collages = [c for c in _legacy_collages(spec) if c.get("nodes")]
    for collage in collages:
        marker = (rel, str(collage.get("id") or ""))
        if marker in done:
            continue
        wanted = _collage_title(session, str(collage.get("name") or ""), len(collages))
        taken = _taken(case, layout.COLLAGE_DIR)
        if wanted is None:
            n = 1
            while f"collage {n}" in taken:
                n += 1
            wanted = f"Collage {n}"
        title = _free_title(taken, wanted, "Collage")
        body = {
            "width": collage.get("width"),
            "height": collage.get("height"),
            "background": collage.get("background"),
            "transparent": bool(collage.get("transparent", False)),
            "nodes": [_pick(n, _PIECE_KEYS) for n in collage["nodes"] if isinstance(n, dict)],
        }
        case.subdir(layout.COLLAGE_DIR)
        target = layout.collage_rel(title)
        _write(case.resolve_inside(target), {
            "azimut_collage": COLLAGE_VERSION,
            "title": title,
            "created_at": spec.get("created_at") or _now(),
            "updated_at": spec.get("updated_at") or _now(),
            **body,
            "migrated_from": {"session": marker[0], "collage": marker[1]},
        })
        attrs: dict[str, Any] = {"spec": target}
        if folder:
            attrs["folder"] = folder
        case.add_entity(COLLAGE_TYPE, title, attrs=attrs, by=PRODUCER)
        done.add(marker)


def _survivor(group: list[tuple[str, dict[str, Any]]]) -> tuple[str, dict[str, Any]]:
    """The spec the others merge into.

    A current work wins, so a merge interrupted after it wrote the survivor resumes
    into the same one. Otherwise the most recently saved session, whose adjustments are
    the analyst's latest intent.
    """
    def key(item: tuple[str, dict[str, Any]]) -> tuple[int, str, str]:
        rel, spec = item
        return (int(spec.get("azimut_inspect") == WORK_VERSION), str(spec.get("updated_at") or ""), rel)

    return max(group, key=key)


def _merged_notes(notes: str, merged: list[tuple[str, str, bool]]) -> str:
    """The survivor's notes, with what each merged session said kept under its name.

    `merged` is (title, notes, typed) per session folded in. A typed name nobody wrote
    notes under is still named, so the analyst can see where it went. Each addition is
    skipped when already present, which is what makes a resumed merge write it once.
    """
    parts = [notes.strip()] if notes.strip() else []
    named = [f"“{title}”" for title, text, typed in merged if typed and not text.strip()]
    if named:
        line = f"Merged with {', '.join(named)}."
        if line not in notes:
            parts.append(line)
    for title, text, _typed in merged:
        block = f"“{title}”: {text.strip()}"
        if text.strip() and block not in notes:
            parts.append(block)
    return "\n\n".join(parts)


def _repoint_links(case: "Case", old_id: str, new_id: str) -> None:
    """Carry an entity's relations over to another, keeping how sure each one is."""
    for link in case.links_of(old_id):
        if link["type"] in link_engine.CHAIN_TYPES:
            continue
        start = new_id if link["from"] == old_id else link["from"]
        end = new_id if link["to"] == old_id else link["to"]
        if start == end:
            continue
        prov = link.get("provenance") or {}
        moved = case.add_link(
            start, end, link["type"],
            by=str(prov.get("by") or PRODUCER),
            status="suggested" if prov.get("status") == "suggested" else "confirmed",
            unique=True,
        )
        rating: dict[str, Any] = {key: link[key] for key in ("confidence", "nature") if key in link}
        if rating:
            case.update_link(moved["id"], rating)
        case.remove_link(link["id"])


def _merge_subject(
    case: "Case",
    subject: str,
    group: list[tuple[str, dict[str, Any]]],
    done: set[tuple[str, str]],
) -> tuple[str, dict[str, Any]]:
    """Fold every spec of one file into a single current work.

    In this order, because the order is what makes an interrupted merge resume rather
    than repeat: collages are carried out first (each marked, so none is made twice),
    then the survivor is written with every frame (merged by id), and only then are
    the others' notes and relations moved and the others removed.
    """
    entities = {rel: case.find_entity(attr="spec", value=rel) for rel, _spec in group}
    owner = case.find_entity(attr="path", value=subject)
    file_label = str((owner or {}).get("label") or Path(subject).stem)
    # What the analyst sees a session as: its entity's label, which a rename from
    # Details moves without rewriting the spec, else the file it is saved under.
    names = {
        rel: str((entities.get(rel) or {}).get("label") or Path(rel).stem) for rel, _spec in group
    }

    def folder_of(rel: str) -> str | None:
        attrs = (entities.get(rel) or {}).get("attrs") or {}
        folder = attrs.get("folder")
        return folder if isinstance(folder, str) and folder else None

    for rel, spec in group:
        if spec.get("azimut_inspect") == LEGACY_VERSION:
            _keep_legacy(case, rel)
            _extract_collages(case, rel, spec, names[rel], folder_of(rel), done)

    rel, base = _survivor(group)
    others = [(r, s) for r, s in group if r != rel]
    frames = [f for f in base.get("frames") or [] if isinstance(f, dict)]
    seen = {f.get("id") for f in frames}
    for _r, spec in others:
        for frame in spec.get("frames") or []:
            if isinstance(frame, dict) and frame.get("id") not in seen:
                frames.append(frame)
                seen.add(frame.get("id"))
    merged_from = list(base.get("merged_from") or [])
    for r, _spec in others:
        if names[r] not in merged_from:
            merged_from.append(names[r])
    survivor = {
        "azimut_inspect": WORK_VERSION,
        "title": Path(rel).stem,
        "created_at": min(
            [str(s.get("created_at")) for _r, s in group if s.get("created_at")] or [_now()]
        ),
        "updated_at": base.get("updated_at") or _now(),
        "source": base.get("source") or {"path": subject},
        "videoAdjust": base.get("videoAdjust") or {},
        "videoRotation": base.get("videoRotation") if base.get("videoRotation") in _RIGHT_ANGLES else 0,
        "videoFiled": base.get("videoFiled"),
        "frames": [_pick(f, _FRAME_KEYS) for f in frames],
        "activeFrameId": base.get("activeFrameId"),
    }
    if merged_from:
        survivor["merged_from"] = merged_from
    _write(case.resolve_inside(rel), survivor)

    entity = entities.get(rel)
    if entity is None:
        entity = case.add_entity(WORK_TYPE, Path(rel).stem, attrs={"spec": rel}, by=PRODUCER)
    attrs = entity.get("attrs") or {}
    patch: dict[str, Any] = {}
    notes = str(attrs.get("notes") or "")
    folded = []
    for r, _spec in others:
        other_notes = str(((entities.get(r) or {}).get("attrs") or {}).get("notes") or "")
        folded.append((names[r], other_notes, not _describes_nothing(names[r], file_label)))
    joined = _merged_notes(notes, folded)
    if joined != notes:
        patch["notes"] = joined
    if not folder_of(rel):
        folder = next((folder_of(r) for r, _s in others if folder_of(r)), None)
        if folder:
            patch["folder"] = folder
    if patch:
        entity = case.update_entity(entity["id"], {"attrs": patch})

    for r, _spec in others:
        other = entities.get(r)
        if other is not None and case.get_entity(other["id"]) is not None:
            _repoint_links(case, other["id"], entity["id"])
            case.remove_entity(other["id"])
        case.resolve_inside(r).unlink(missing_ok=True)

    # A name the app made up says nothing about the work; the file's own name does,
    # and a typed name on one of the merged sessions is the analyst's, so that is
    # the one the work keeps.
    label = str(entity.get("label") or survivor["title"])
    if _describes_nothing(label, file_label):
        newest_first = sorted(others, key=lambda i: str(i[1].get("updated_at") or ""), reverse=True)
        typed = next(
            (names[r] for r, _s in newest_first if not _describes_nothing(names[r], file_label)),
            None,
        )
        wanted = typed or file_label
        taken = _taken(case, layout.INSPECT_DIR) - {Path(rel).stem.casefold()}
        title = _free_title(taken, wanted, "Inspect")
        if title != Path(rel).stem:
            entity = case.update_entity(entity["id"], {"label": title})
            rel = str((entity.get("attrs") or {}).get("spec") or rel)
            survivor["title"] = title
            _write(case.resolve_inside(rel), survivor)
    link_engine.sync(case, entity["id"], link_engine.DEPENDS_ON, [subject], by=PRODUCER)
    return rel, survivor


def normalize(case: "Case") -> dict[str, int]:
    """Give every file one work and every collage its own document.

    The 0.3.1 case migration, and what a restore from the Trash runs so an older
    session brought back into a current case lands the same way. A spec whose file
    cannot be named is left as it is: there is nothing to merge it into.
    """
    with case.lock:
        groups: dict[str, list[tuple[str, dict[str, Any]]]] = {}
        for rel, spec in _work_specs(case):
            subject = _subject(spec)
            if subject:
                groups.setdefault(subject, []).append((rel, spec))
        done = _migrated_collages(case)
        before = len(done)
        merged = 0
        for subject, group in groups.items():
            if len(group) == 1 and group[0][1].get("azimut_inspect") == WORK_VERSION:
                continue
            _merge_subject(case, subject, group, done)
            merged += len(group) - 1
    return {"merged": merged, "collages": len(done) - before}


def migrate_case(case: "Case") -> None:
    """The first half of folder migration 9 → 11 (`workspace.FOLDER_MIGRATIONS`)."""
    normalize(case)
