"""A saved record renamed, and every reference to it carried along.

A proof, a post, a collage, a comparison, a Horizon view, a map plate, a sheet and an
Inspect work are each named by their file, so a rename moves files: the record, and
whatever `artifacts.KINDS` names after it (a proof's export and its pasted images, a
preview, a sheet's sidecar). What names those files elsewhere has to follow, or a post
loses its proof and shows it again as one still to post.

**By path.** `rewrite_references` rewrites every string equal to an old path, as a
value or as a key: the graph's attributes and the queued jobs
(`Case.replace_path_references`), the media sidecars, the tools' saved records, and a
note's `/files/` address. Prose is never edited, and a media rename goes through the
same rewrite (`media.finish_media_rename`).

**By name.** A few fields hold a record's name rather than a path, and `_NAMED`
follows them: a video thread keys the post of each place by its proof's name, a
proof's dating statement is labelled with it, and a collage's exported picture opens
the collage by its name.

**Interrupted.** A rename is written down before anything moves, and every step reads
what is on disk, so running it again finishes it. `recover` does that on every open of
the case (`Case.open`) and before the next rename, so a crash between moving the files
and rewriting what names them never leaves a post pointing at a file that is gone. A
record's rename is written in `.data/rename-record.json`, a media's in
`.data/rename.json` as before: renaming a file renames the Inspect work still named
after it, so one rename runs inside the other and each keeps its own journal.
"""

from __future__ import annotations

import json
import logging
import re
import shutil
import threading
from contextlib import contextmanager
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING, Any, Callable, Iterator
from urllib.parse import quote, unquote

from .. import layout
from ..store.rows import replace_paths
from ..workspace import CaseError, ensure_dir, write_text_atomic

if TYPE_CHECKING:
    from ..workspace import Case

logger = logging.getLogger(__name__)

#: How a video thread keys the post of one place: by its proof's name (frontend
#: `lib/videoPost.js`), in a draft's ``first`` and each later post's ``key``.
THREAD_PLACE = "place:"

#: The cases this thread is finishing a rename of: the rewrite saves entities, and an
#: open of the case on the way must not start the same rename over.
_finishing = threading.local()


def record_journal(case: "Case") -> Path:
    """Where a saved record's rename in progress is written down."""
    return layout.data_dir(case.path) / "rename-record.json"


def media_journal(case: "Case") -> Path:
    """Where a media rename in progress is written down (`media.rename_media`)."""
    return layout.data_dir(case.path) / "rename.json"


def write_journal(path: Path, record: dict[str, Any]) -> None:
    write_text_atomic(path, json.dumps(record, indent=2, ensure_ascii=False) + "\n")


def _busy() -> set[str]:
    held: set[str] | None = getattr(_finishing, "cases", None)
    if held is None:
        held = set()
        _finishing.cases = held
    return held


@contextmanager
def finishing(case: "Case") -> Iterator[None]:
    """While a rename is carried out: nothing on the way recovers one."""
    key = str(case.path)
    busy = _busy()
    nested = key in busy
    busy.add(key)
    try:
        yield
    finally:
        if not nested:
            busy.discard(key)


# -- what names a file ----------------------------------------------------------------


def _record_paths(case: "Case") -> list[Path]:
    """The tools' saved records that can name a case file."""
    tool = case.tool_root
    roots = (
        layout.subdir(case.path, "proofs") / layout.META_DIR,
        tool / layout.INSPECT_DIR,
        tool / layout.COLLAGE_DIR,
        tool / layout.DRAFTS_DIR,
        tool / layout.SEARCH_DIR,
        # Horizon's saved views and the bench's `.work.json`, then its searches.
        tool / layout.HORIZON_DIR,
        tool / layout.HORIZON_DIR / layout.HORIZON_FINDS_DIR,
        tool / layout.MAPPLATE_DIR,
    )
    return [path for root in roots if root.is_dir() for path in sorted(root.glob("*.json"))]


def _note_files(case: "Case") -> Iterator[Path]:
    """The case's running notes, then every filed note."""
    yield case.notes_path
    cursor: str | None = None
    while True:
        page = case.page_entities(types=["note"], limit=500, cursor=cursor)
        for entity in page["items"]:
            path = (entity.get("attrs") or {}).get("path")
            if not isinstance(path, str) or not path:
                continue
            try:
                yield case.resolve_inside(path)
            except CaseError:
                continue
        cursor = page.get("next_cursor")
        if not cursor:
            return


#: A case file's address as the Notebook writes it (frontend `lib/fileUrl.js`): the
#: case, then the path, each segment encoded. Encoding keeps brackets, so a name such
#: as `IMG (1).jpg` holds a pair, which is how it is told from the link's own `)`.
_FILE_ADDRESS = re.compile(
    r"/files/([^/\s()\"'<>]+)/((?:[^\s()\"'<>?#]|\([^\s()\"'<>?#]*\))+)"
)


def _encoded(rel: str) -> str:
    """A case path as `encodeRelPath` writes it: each segment as `encodeURIComponent` does."""
    return "/".join(quote(part, safe="-_.!~*'()") for part in rel.split("/"))


def _rewrite_note_addresses(case: "Case", moved: dict[str, str]) -> None:
    """Point a note's picture written as a case file's address at where the file went.

    A picture with a record of its own is written by its id (`[[media:…]]`), which a
    rename never touches; one added without is written by its address.
    """
    for file in _note_files(case):
        try:
            text = file.read_text(encoding="utf-8")
        except OSError:
            continue
        if "/files/" not in text:
            continue

        def follow(match: re.Match[str]) -> str:
            if unquote(match.group(1)) != case.id:
                return match.group(0)
            target = moved.get(unquote(match.group(2)))
            return match.group(0) if target is None else f"/files/{match.group(1)}/{_encoded(target)}"

        rewritten = _FILE_ADDRESS.sub(follow, text)
        if rewritten != text:
            write_text_atomic(file, rewritten)


def rewrite_files(case: "Case", moved: dict[str, str]) -> None:
    """Rewrite the paths ``moved`` names in everything kept outside the database:
    media sidecars (and their rows in the media index), the tools' saved records and
    the notes."""
    moved = {old: new for old, new in moved.items() if old != new}
    if not moved:
        return
    from . import media as media_engine

    sidecars = case.subdir("media") / layout.META_DIR
    if sidecars.is_dir():
        for sidecar in sorted(sidecars.glob("*.json")):
            try:
                data = json.loads(sidecar.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            replaced = replace_paths(data, moved)
            if replaced == data:
                continue
            media_engine.write_json_atomic(sidecar, replaced)
            media_name = sidecar.name.removesuffix(".json")
            entity = case.find_entity(attr="path", value=f"media/{media_name}")
            case.upsert_media_item(
                {**replaced, "path": f"media/{media_name}"},
                entity_id=entity["id"] if entity else None,
            )

    for path in _record_paths(case):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        replaced = replace_paths(data, moved)
        if replaced != data:
            media_engine.write_json_atomic(path, replaced)

    _rewrite_note_addresses(case, moved)


def rewrite_references(case: "Case", moved: dict[str, str]) -> None:
    """Point every stored reference to each old path at its new one: the graph and the
    queued jobs, then everything kept outside the database (`rewrite_files`)."""
    moved = {old: new for old, new in moved.items() if old != new}
    for old, new in moved.items():
        case.replace_path_references(old, new)
    rewrite_files(case, moved)


# -- what names a record ---------------------------------------------------------------


def _drafts(case: "Case") -> Iterator[tuple[Path, dict[str, Any]]]:
    folder = case.tool_root / layout.DRAFTS_DIR
    for path in sorted(folder.glob("*.json")) if folder.is_dir() else []:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(data, dict) and isinstance(data.get("state"), dict):
            yield path, data


def _entities_holding(case: "Case", type_: str, attr: str, value: str) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    cursor: str | None = None
    while True:
        page = case.page_entities(limit=200, cursor=cursor, types=[type_], attr=attr, attr_value=value)
        found.extend(page["items"])
        cursor = page.get("next_cursor")
        if not cursor:
            return found


def _proof_named(case: "Case", old: str, new: str) -> None:
    """A video thread's post of one place keeps the words the analyst gave it under its
    proof's name, and the date a proof states is labelled with the proof's name."""
    from . import media as media_engine
    from . import scenes as scene_engine

    was, now = f"{THREAD_PLACE}{old}", f"{THREAD_PLACE}{new}"
    for path, data in _drafts(case):
        state = data["state"]
        changed = False
        if state.get("first") == was:
            state["first"] = now
            changed = True
        posts = state.get("extraTweets")
        for post in posts if isinstance(posts, list) else []:
            if isinstance(post, dict) and post.get("key") == was:
                post["key"] = now
                changed = True
        if changed:
            media_engine.write_json_atomic(path, data)

    spec = layout.proof_spec_rel(new)
    for claim in _entities_holding(case, "claim", scene_engine.DATED_BY, spec):
        # reworded by hand, it is the analyst's sentence and stays
        if claim.get("label") == scene_engine.dating_label(old):
            case.update_entity(claim["id"], {"label": scene_engine.dating_label(new)})


def _collage_named(case: "Case", old: str, new: str) -> None:
    """A collage's exported picture opens the collage it came from by its name."""
    for picture in _entities_holding(case, "media", "collage", old):
        case.update_entity(picture["id"], {"attrs": {"collage": new}})


#: The records named by their name somewhere, and what follows them.
_NAMED: dict[str, Callable[["Case", str, str], None]] = {
    "proof": _proof_named,
    "collage": _collage_named,
}


# -- the rename -----------------------------------------------------------------------


def _moves(type_: str, old_rel: str, new_rel: str) -> list[list[str]]:
    """The record, then each file named after it, from where it is to where it goes."""
    from .artifacts import KINDS, Named

    old, new = PurePosixPath(old_rel).stem, PurePosixPath(new_rel).stem
    moves = [[old_rel, new_rel]]
    for companion in KINDS[type_].companions:
        if isinstance(companion, Named):
            moves.append([companion.build(old), companion.build(new)])
    return moves


def _move(case: "Case", source_rel: str, target_rel: str, *, main: bool) -> None:
    """Move one file or folder, or do nothing when it has moved already or never was.

    The record itself only lands on a free name, as every save checks before it renames.
    What is named after it replaces whatever lies at its new name, a picture or a folder
    nothing points at. Windows refuses to rename onto a folder, so that one is moved
    aside and deleted last.
    """
    from . import media as media_engine

    source = case.resolve_inside(source_rel)
    if not source.exists():
        return
    # The name asked for, not a resolved one: Windows resolves a path to the case on disk.
    if PurePosixPath(source_rel).parent == PurePosixPath(target_rel).parent:
        target = source.with_name(PurePosixPath(target_rel).name)
    else:
        target = case.resolve_inside(target_rel)
    if str(source) == str(target):
        return
    if source.parent == target.parent and source.name.casefold() == target.name.casefold():
        media_engine.rename_path(source, target)  # one file under both names on Windows and macOS
        return
    ensure_dir(target.parent)
    if not target.exists():
        source.rename(target)
    elif main:
        raise CaseError(f"a file named '{target.name}' already exists")
    elif target.is_dir():
        aside = target.with_name(f"{target.name}.stale")
        shutil.rmtree(aside, ignore_errors=True)
        target.rename(aside)
        source.rename(target)
        shutil.rmtree(aside, ignore_errors=True)
    else:
        source.replace(target)


def title_record(case: "Case", rel: str) -> None:
    """A saved record's ``title`` says the name its file has."""
    from . import media as media_engine

    name = PurePosixPath(rel).stem
    path = case.resolve_inside(rel)
    if path.suffix != ".json" or not path.is_file():
        return
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return
    if isinstance(data, dict) and "title" in data and data["title"] != name:
        data["title"] = name
        media_engine.write_json_atomic(path, data)


def _retitle(case: "Case", type_: str, rel: str) -> None:
    """The record says its new name, and so does its entity."""
    from .artifacts import KINDS

    title_record(case, rel)
    name = PurePosixPath(rel).stem
    attr = KINDS[type_].path_attr
    entity = case.find_entity(attr=attr, value=rel)
    if entity is not None and entity.get("label") != name:
        # stating the path tells the rename hooks the move is already done
        case.update_entity(entity["id"], {"label": name, "attrs": {attr: rel}})


def _finish(case: "Case", record: dict[str, Any]) -> None:
    """Carry out one journalled rename. Safe to run again at any point."""
    moves = [(str(old), str(new)) for old, new in record["moves"]]
    for index, (old, new) in enumerate(moves):
        _move(case, old, new, main=index == 0)
    rewrite_references(case, dict(moves))
    old_name, new_name = record["names"]
    follow = _NAMED.get(record["type"])
    if follow is not None:
        follow(case, str(old_name), str(new_name))
    _retitle(case, record["type"], moves[0][1])
    record_journal(case).unlink(missing_ok=True)


def rename_record(case: "Case", type_: str, old_rel: str, new_rel: str) -> None:
    """Move a saved record, and what is named after it, from ``old_rel`` to ``new_rel``,
    and carry every reference to them along. The caller has checked the new name is free.
    """
    if old_rel == new_rel:
        return
    with case.lock:
        recover(case, strict=True)
        record = {
            "type": type_,
            "names": [PurePosixPath(old_rel).stem, PurePosixPath(new_rel).stem],
            "moves": _moves(type_, old_rel, new_rel),
        }
        write_journal(record_journal(case), record)
        with finishing(case):
            _finish(case, record)


def _valid_record(record: Any) -> bool:
    if not isinstance(record, dict):
        return False
    moves, names = record.get("moves"), record.get("names")
    return (
        isinstance(record.get("type"), str)
        and isinstance(moves, list)
        and bool(moves)
        and all(isinstance(m, list) and len(m) == 2 and all(isinstance(p, str) for p in m) for m in moves)
        and isinstance(names, list)
        and len(names) == 2
        and all(isinstance(n, str) for n in names)
    )


def _valid_media(record: Any) -> bool:
    return isinstance(record, dict) and all(isinstance(record.get(key), str) for key in ("old", "new", "title"))


def recover(case: "Case", *, strict: bool = False) -> None:
    """Finish a rename an interruption left halfway: a record's first, since one runs
    inside a media rename, then a media's.

    Run on every open of the case, where a failure is logged and the journal kept for
    the next open, and ``strict`` before a rename, which is refused until it finishes.
    """
    from . import media as media_engine

    pending = [path for path in (record_journal(case), media_journal(case)) if path.exists()]
    if not pending or str(case.path) in _busy():
        return
    try:
        with case.lock:
            for path, valid, finish in (
                (record_journal(case), _valid_record, _finish),
                (media_journal(case), _valid_media, media_engine.finish_media_rename),
            ):
                if not path.exists():
                    continue  # never begun, or another thread finished it while this one waited
                try:
                    record = json.loads(path.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError) as exc:
                    raise CaseError("a rename journal is unreadable") from exc
                if not valid(record):
                    raise CaseError("a rename journal is invalid")
                with finishing(case):
                    finish(case, record)
    except Exception:
        if strict:
            raise
        logger.warning("could not finish an interrupted rename in case %s", case.id, exc_info=True)
