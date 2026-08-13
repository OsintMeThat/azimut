"""How a case folder is shaped on disk, and how an older one is brought to it.

Two things live here. The small filesystem primitives every case write goes
through — creating a directory, hiding a dotted one on Windows, leaving the
README — and the pass that reshapes a case folder laid out by an earlier version
into the current shape.

That pass is a folder migration (`workspace.FOLDER_MIGRATIONS`), run once on open
and never again: it wraps a bare folder, flattens the trash, moves the machinery
out of sight, names notes after their titles and aligns visible names. Each step
is separately restartable, because a case half-migrated by a crash has to be able
to finish rather than be refused.

It is kept apart from `workspace.py` because it is about the *shape of a
directory*, not about what a case is: nothing here reads the graph, and `Case`
appears only as the thing being reshaped.
"""

from __future__ import annotations

import shutil
import time
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable

from . import config, layout

if TYPE_CHECKING:
    from .workspace import Case


def ensure_dir(path: Path) -> Path:
    """``path.mkdir(parents=True, exist_ok=True)``, tolerant of a transient
    ``PermissionError`` Windows can raise when several threads race to create
    the very same directory for the first time (e.g. several concurrent
    downloads all hitting a case's not-yet-created ``media/.dl`` or
    ``media/.thumbs`` at once): CreateDirectory there occasionally answers
    "access is denied" instead of "already exists" mid-race, which
    ``exist_ok=True`` alone does not catch. Retried briefly — the directory
    reliably exists by the next attempt, whoever won the race.
    """
    for attempt in range(20):
        try:
            path.mkdir(parents=True, exist_ok=True)
            _hide_dotted_chain(path)
            return path
        except PermissionError:
            if path.is_dir():
                return path
            if attempt == 19:
                raise
            time.sleep(0.01)
    return path  # pragma: no cover - loop always returns or raises above


def _hide_dotted_chain(path: Path) -> None:
    """Hide *path* on Windows, and the dot-directories `parents=True` just made.

    `media/.meta/<proof>.assets` creates `.meta` on the way to a leaf that is
    not itself dotted, so hiding the leaf alone would leave the directory that
    matters visible. The walk stops at the first ancestor without a leading dot,
    which is always the visible half of the case (`media/`, `proofs/`, the tool
    root), so it never climbs out of the workspace.
    """
    current = path
    while True:
        config.hide_if_dotted(current)
        parent = current.parent
        if parent == current or not parent.name.startswith("."):
            return
        current = parent


def _follow_hidden_dirs(root: Path) -> None:
    """Put the hidden attribute back on a case's internal directories.

    `.azimut` gets this at every startup (`config.ensure_workspace`); a case only
    got it the day it was born, so any copy of a workspace — a move onto another
    drive, a folder carried between machines, a backup unpacked — showed the
    analyst directories the layout means to keep out of sight.

    Costs nothing off Windows, where `hide_if_dotted` is what returns early: one
    guard in one place beats a second copy of the platform test here.
    """
    for directory in layout.hidden_dirs(root):
        config.hide_if_dotted(directory)


def write_readme(root: Path) -> None:
    """Leave the note that says which half of the case folder is whose.

    Only when there is none. The file sits in the analyst's half, so once it is
    there it is theirs: an edited or deleted README is a choice, not damage, and
    rewriting it on every open would undo it.
    """
    readme = layout.readme(root)
    if not readme.exists():
        readme.write_text(layout.README_TEXT, encoding="utf-8")



def _wrap_case_folder(case: "Case") -> None:
    """Move the tool's files into `azimut/`.

    What this buys is in `layout.py`: the case root becomes the analyst's, and a
    folder they create there can no longer collide with one of ours.

    Nothing inside is rewritten. Paths are stored relative to the tool root
    (`media/x.png`), so they go on meaning the same thing one level down — the
    database, the sidecars and any bundle are untouched.

    **Only the tool's own entries move** (`layout.UNWRAPPED_ENTRIES`). Nothing
    stopped an analyst from keeping their own folder beside a case before this,
    and carrying it into `azimut/` would contradict the very boundary being
    drawn. Anything unrecognised stays at the case root, which is where it now
    belongs anyway.

    **The manifest moves last.** While it is still at the case root the move is
    unfinished, and that is exactly what `layout.needs_wrapper` reads, so a
    power cut mid-move is resumed rather than half-applied. Runs before anything
    reads the manifest, which is why it is keyed on the filesystem rather than
    on a schema number nobody could load yet.
    """
    root = case.path
    if not layout.needs_wrapper(root):
        return
    tool = layout.tool_root(root)
    tool.mkdir(exist_ok=True)
    ours = [root / name for name in layout.UNWRAPPED_ENTRIES]
    ours += sorted(root.glob(layout.UNWRAPPED_BACKUP_GLOB))
    for entry in dict.fromkeys(ours):
        destination = tool / entry.name
        if not entry.exists() or destination.exists():
            continue  # absent, or already carried over by an interrupted run
        shutil.move(str(entry), str(destination))
    shutil.move(str(layout.unwrapped_manifest(root)), str(layout.manifest(root)))
    case._forget_store()  # the database is at a new path now


def _flatten_trash(case: "Case") -> None:
    """Make trash groups stop mirroring the case tree.

    A group used to hold ``media/clip.mp4`` under its own directory, stacking
    two case trees and making the trash the longest path Azimut could write —
    on its own enough to pass Windows' 260-character limit. The journal already
    knows where each file came from, so the files move to numbered slots and the
    payload gains the ``slots`` list that pairs with ``files``.

    Idempotent: a file already in its slot is left alone, so an interrupted run
    resumes.
    """
    from .engine.trash import slots_for

    groups = [g["id"] for g in case.list_trash()]
    groups += [g["id"] for g in case.list_incomplete_trash()]
    for group_id in dict.fromkeys(groups):
        group = case.get_trash_group(group_id)
        if group is None:
            continue
        payload = dict(group.get("payload") or {})
        files = [str(rel) for rel in (payload.get("files") or [])]
        slots = slots_for(files)
        root = case.trash_dir / group_id
        for rel, slot in zip(files, slots):
            source = root / rel
            destination = root / slot
            if source.exists() and not destination.exists():
                shutil.move(str(source), str(destination))
        _drop_empty_dirs(root)
        payload["slots"] = slots
        case.update_trash_group(group_id, payload=payload)


def _drop_empty_dirs(root: Path) -> None:
    """Remove the directories a mirrored group left behind, deepest first."""
    if not root.is_dir():
        return
    for path in sorted(root.rglob("*"), key=lambda p: len(p.parts), reverse=True):
        if path.is_dir() and not any(path.iterdir()):
            path.rmdir()


def _prune_empty_note_dirs(root: Path, directory: Path) -> None:
    """Drop the folder directories a moved note left empty, up to `notes/`.

    A mirrored tree that keeps every directory a note ever passed through stops
    being a mirror. Stops at `notes/` itself, which is born with the case.

    Both paths are resolved before they are compared. Callers hand in the note
    directory as the case knows it and the note's own parent as
    `resolve_inside` returned it, which are the same directory in two spellings
    the moment a symlink sits anywhere above the workspace: macOS reaches every
    temporary directory through `/var` → `/private/var`, and a workspace under a
    synced or linked folder does the same on any platform. Comparing the two
    spellings makes the containment check say "outside", and the loop that
    should prune then does nothing at all.
    """
    root = root.resolve()
    directory = directory.resolve()
    while directory != root and directory.is_relative_to(root):
        try:
            if any(directory.iterdir()):
                return
            directory.rmdir()
        except OSError:
            return
        directory = directory.parent


def _move_into(source: Path, destination: Path) -> None:
    """Carry one entry over, skipping what an interrupted run already moved."""
    if not source.exists() or destination.exists():
        return
    ensure_dir(destination.parent)
    shutil.move(str(source), str(destination))


def _hide_the_machinery(case: "Case") -> None:
    """Move what only Azimut can read out of the way.

    The rule is in `layout.py`: visible means openable in another program.
    Applied here it moves the database into `.data/`, the media sidecars into
    `media/.meta/`, the proof specs and their pasted assets into
    `proofs/.meta/`, and renames `inspect/` and `search/` to dot-directories.

    `exports/` is the one that changes meaning rather than place. It held post
    drafts — its name was wrong — so the drafts become `.drafts/` and a fresh,
    empty `exports/` is left behind for what the word actually promises.

    This is the first folder step that rewrites *stored* paths: a proof's
    ``spec``, a session's ``spec`` and a post's ``draft`` all name a directory
    that just moved.
    """
    root = case.path
    tool = layout.tool_root(root)

    # The database first, and with no connection open: on Windows an open file
    # cannot be moved. Nothing holds one here — every backend connection is
    # scoped to its own `with` — but the cached handle is dropped anyway so the
    # next access re-resolves against the new path.
    _move_into(tool / layout.PRE_HIDDEN_DB, layout.database(root))
    case._forget_store()

    # Sidecars: `media/clip.mp4.azimut.json` -> `media/.meta/clip.mp4.json`.
    media_dir = layout.media(root)
    if media_dir.is_dir():
        suffix = layout.PRE_HIDDEN_SIDECAR_SUFFIX
        for sidecar in sorted(media_dir.glob(f"*{suffix}")):
            name = sidecar.name[: -len(suffix)]
            _move_into(sidecar, case.resolve_inside(layout.sidecar_rel(name)))

    # Proof specs and pasted assets join them; the rendered PNG stays visible.
    proofs_dir = layout.subdir(root, "proofs")
    if proofs_dir.is_dir():
        for spec in sorted(proofs_dir.glob("*.json")):
            _move_into(spec, case.resolve_inside(layout.proof_spec_rel(spec.stem)))
        for assets in sorted(proofs_dir.glob("*.assets")):
            _move_into(assets, case.resolve_inside(layout.proof_assets_rel(assets.stem)))

    # The sidecars just moved, and the one-time browse-index backfill may have
    # already run against their old location. Forget it, so the reopen below
    # rebuilds the index from where they are now.
    store = case._sqlite
    if store is not None:
        store.forget_media_index()
        case._forget_store()

    for old, new in layout.PRE_HIDDEN_DIRS.items():
        _move_into(tool / old, tool / new)
    for directory in layout.content_dirs(root):
        ensure_dir(directory)

    _rewrite_moved_paths(case)


#: entity type -> (attribute holding a case-relative path, old prefix, rebuild).
_MOVED_ATTRS: dict[str, tuple[str, str, Callable[[str], str]]] = {
    "proof": ("spec", "proofs/", layout.proof_spec_rel),
    "inspect-session": ("spec", "inspect/", layout.session_rel),
    "post": ("draft", "exports/", layout.draft_rel),
}


def _rewrite_moved_paths(case: "Case") -> None:
    """Point the graph at the directories the migration just renamed.

    Only entities still naming the old location are touched, so a re-run after
    an interruption rewrites nothing twice.
    """
    for entity in case.list_entities():
        rule = _MOVED_ATTRS.get(str(entity.get("type") or ""))
        if rule is None:
            continue
        attribute, prefix, rebuild = rule
        current = (entity.get("attrs") or {}).get(attribute)
        if not isinstance(current, str) or not current.startswith(prefix):
            continue
        stem = Path(current).stem
        case.update_entity(entity["id"], {"attrs": {attribute: rebuild(stem)}})


def _name_notes_after_their_titles(case: "Case") -> None:
    """Make notes stop being named after their entity id.

    `notes/e_03aeb50d41.md` was visible and illegible — in the way without being
    readable. Every other document already follows "the name is the filename";
    notes were the only holdout, and only because they are generic entities with
    their path hardcoded rather than a tool of their own.

    Titles are not unique, so a collision inside one folder takes a numbered
    suffix, exactly as a new note would.

    An empty patch is the whole migration: `update_entity` already moves a note
    whose title or folder no longer matches its filename. Once moved, the
    current path is reserved for that note, so a resumed pass leaves the path
    and any collision suffix unchanged.
    """
    for entity in case.list_entities():
        if entity.get("type") == "note":
            case.update_entity(entity["id"], {})


def _leave_a_readme(case: "Case") -> None:
    """Teach a case that predates the free zone which half is whose.

    The wrapper gave the analyst the case root three schemas ago; nothing on
    disk told them. This is the step that does, and it is the only migration
    here that writes into their half of the folder rather than ours.
    """
    write_readme(case.path)


def _align_visible_names(case: "Case") -> None:
    """Make every analyst-visible filename stem the name Azimut displays.

    Uploads belong to the analyst, so their existing filename wins. Downloads,
    captures and derived media belong to an Azimut save gate, so their stored
    title wins and machine timestamps/remote ids remain provenance. Named
    documents run through their existing rename hooks, which also repairs a
    Details edit that changed only the graph label.
    """
    from .engine import media as media_engine

    media_engine.recover_media_rename(case)
    for item in list(case.list_media_items()):
        path = str(item.get("path") or "")
        if not path:
            continue
        source: dict[str, Any] = item["source"] if isinstance(item.get("source"), dict) else {}
        entity = case.find_entity(attr="path", value=path)
        if source.get("type") == "upload":
            desired = Path(path).stem
        else:
            desired = str(item.get("title") or (entity or {}).get("label") or Path(path).stem)
        # `Case.migrate` already owns the case lock. An older case cannot have
        # live work in this process; waiting here would deadlock a test that
        # deliberately rewinds a just-created case while its worker is draining.
        media_engine.rename_media(case, path, desired, settle_worker=False)

    for entity in list(case.list_entities()):
        if entity.get("type") in {"note", "proof", "inspect-session", "post"}:
            case.update_entity(entity["id"], {"label": entity.get("label") or ""})


def _normalize_case_layout(case: "Case") -> None:
    """Bring every unreleased folder checkpoint to the final layout.

    Schemas 4 through 7 were useful while building the layout, but no released
    Azimut wrote them. One normalizer accepts schema 3 and those development
    states, applies every operation in dependency order, then the runner stamps
    the current schema once. Each operation is idempotent, so an interrupted
    pass restarts here without guessing which line completed.
    """
    _wrap_case_folder(case)
    _flatten_trash(case)
    _hide_the_machinery(case)
    _name_notes_after_their_titles(case)
    _leave_a_readme(case)
    _align_visible_names(case)
