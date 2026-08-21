"""What an entity owns on disk.

One declaration per entity type, read by everything that has to move an
artifact's files. Before this module the knowledge sat in a single ``elif``
chain in ``api/cases.py``, and that chain already had a hole: deleting a proof
dropped its spec and its export but left ``proofs/<name>.assets/`` behind, so
pasted images outlived the composition they belonged to.

A type with no intrinsic artifact says so in `NO_FILES`, with the reason beside
it. Optional private entity photos are a cross-cutting ownership rule. A type in
neither table is an oversight, and `tests/test_artifacts.py` fails on it: a new
tool declares what it writes, or it does not ship.

Companions are the files named after the main artifact — a media's sidecar, a
proof's export and its assets folder. A companion that does not `travels` is a
disposable cache: it is dropped on delete and never carried aside, because a
content-addressed thumbnail is shared between identical media and moving one
would blank a surviving row.
"""

from __future__ import annotations

import json
import shutil
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING, Any, ClassVar

from .. import layout
from ..workspace import CaseError
from . import media as media_engine

if TYPE_CHECKING:
    from ..workspace import Case


@dataclass(frozen=True)
class Companion:
    """A file an entity owns whose name follows its main artifact."""

    #: False for a disposable, possibly shared cache: dropped on delete, never
    #: moved aside with the artifact.
    travels: ClassVar[bool] = True

    def resolve(self, case: "Case", main: str) -> str | None:
        raise NotImplementedError


@dataclass(frozen=True)
class Sidecar(Companion):
    """The media sidecar, out of the listing in ``media/.meta/``."""

    def resolve(self, case: "Case", main: str) -> str | None:
        return layout.sidecar_rel(main)


@dataclass(frozen=True)
class Named(Companion):
    """A companion the layout names after the main artifact's stem.

    A proof's spec lives in ``proofs/.meta/`` while the PNG it renders stays
    visible in ``proofs/``, so "same name, swapped suffix" stopped being enough
    — where each one goes is `layout`'s answer, not a string operation.
    """

    build: Callable[[str], str]

    def resolve(self, case: "Case", main: str) -> str | None:
        return self.build(PurePosixPath(main).stem)


@dataclass(frozen=True)
class SharedThumb(Companion):
    """The cached thumbnail a media's sidecar records.

    Content-addressed, so two identical files share one, which is exactly why it
    never travels: moving it aside would blank whatever else points at it.
    """

    travels: ClassVar[bool] = False

    def resolve(self, case: "Case", main: str) -> str | None:
        item = media_engine.read_item(case, main)
        thumb = (item or {}).get("thumbnail")
        return thumb if isinstance(thumb, str) and thumb else None


@dataclass(frozen=True)
class Kind:
    """One entity type's files: the attribute holding its main artifact, and
    whatever is named after it."""

    path_attr: str
    companions: tuple[Companion, ...] = field(default_factory=tuple)
    #: True when the media browse index holds a row keyed by the main path, so a
    #: delete has to unfile it and a restore has to file it again.
    indexed: bool = False


#: Entity type -> what it owns. The only place these rules live.
KINDS: dict[str, Kind] = {
    "media": Kind(path_attr="path", companions=(Sidecar(), SharedThumb()), indexed=True),
    "capture": Kind(path_attr="path", companions=(Sidecar(), SharedThumb()), indexed=True),
    "proof": Kind(
        path_attr="spec",
        companions=(
            Named(layout.proof_export_rel),
            Named(layout.proof_assets_rel),
        ),
    ),
    "post": Kind(path_attr="draft"),
    "inspect-session": Kind(path_attr="spec"),
    "note": Kind(path_attr="path"),
    "sheet": Kind(path_attr="path", companions=(Named(layout.sheet_meta_rel),)),
}

#: Types with no intrinsic main artifact, and why. Supported entities can still
#: own optional private presentation photos through `_direct_entity_photos`.
#: A free-typed entity the analyst invents needs no entry — it is a label in the
#: graph until a tool gives it a file, and that tool declares it in `KINDS`.
NO_FILES: dict[str, str] = {
    "place": "coordinates and a label",
    "person": "an identity in the graph",
    "organization": "an identity in the graph",
    "account": "an identity in the graph",
    "email": "an identifier in the graph",
    "phone": "an identifier in the graph",
    "domain": "an identifier in the graph",
    "ip": "an identifier in the graph",
    "network": "an identifier in the graph",
    "vehicle": "an identity in the graph",
    "vessel": "an identity in the graph",
    "aircraft": "an identity in the graph",
    "structure": "an identity in the graph",
    "equipment-type": "a model in the graph, which owns no object of its own",
    "bookmark": "a URL in the graph",
    "claim": "a statement in the graph, and the edges that carry it",
}


def declares(type_: str) -> bool:
    """Whether this entity type has decided what it owns on disk."""
    return type_ in KINDS or type_ in NO_FILES


def _resolve(case: "Case", rel: str) -> Path | None:
    """The absolute path of a case-relative artifact, or None when a doctored
    attribute addresses something outside the case."""
    try:
        return case.resolve_inside(rel)
    except CaseError:
        return None


def _main_path(entity: dict[str, Any]) -> tuple[Kind, str] | None:
    kind = KINDS.get(str(entity.get("type") or ""))
    if kind is None:
        return None
    main = (entity.get("attrs") or {}).get(kind.path_attr)
    if not isinstance(main, str) or not main:
        return None
    return kind, main


def _paths(case: "Case", entity: dict[str, Any], *, travelling: bool) -> list[str]:
    found = _main_path(entity)
    if found is None:
        return []
    kind, main = found
    rels = [main] if travelling else []
    for companion in kind.companions:
        if companion.travels != travelling:
            continue
        rel = companion.resolve(case, main)
        if rel:
            rels.append(rel)
    out = []
    for rel in dict.fromkeys(rels):
        path = _resolve(case, rel)
        if path is not None and path.exists():
            out.append(rel)
    return out


def _direct_entity_photos(case: "Case", entity: dict[str, Any]) -> list[str]:
    """Private presentation files owned by this entity, if it has any.

    Gallery rows that point into the Media Library own no bytes here. The Media
    entity remains the sole owner of those files.
    """
    out: list[str] = []
    for image in case.entity_images(str(entity.get("id") or "")):
        if not image.get("direct"):
            continue
        for rel in (image.get("path"), image.get("thumbnail")):
            if not isinstance(rel, str) or not rel:
                continue
            path = _resolve(case, rel)
            if path is not None and path.exists():
                out.append(rel)
    return list(dict.fromkeys(out))


def owned(case: "Case", entity: dict[str, Any]) -> list[str]:
    """The case-relative files and folders this entity owns, that exist now.

    These are what a delete removes and what the trash moves aside.
    """
    return list(
        dict.fromkeys(
            [
                *_paths(case, entity, travelling=True),
                *_direct_entity_photos(case, entity),
            ]
        )
    )


def spec_thumb(case: "Case", entity: dict[str, Any]) -> str | None:
    """The cached thumbnail an entity's own spec file records, if it keeps one there.

    A proof is the one kind that does: its preview is written into
    ``proofs/.meta/<name>.json`` when the export is rendered. That is the wrong place
    for something a surface might need for a few hundred entities at once — the graph
    answers from the database alone — so the caller copies what this returns onto the
    entity, once, and reads it off the row from then on.

    Unreadable, missing or thumbnail-less spec: None. A preview is disposable pixels,
    and never a reason for a drawing to fail.
    """
    spec_rel = entity.get("attrs", {}).get("spec")
    if not isinstance(spec_rel, str) or not spec_rel:
        return None
    path = _resolve(case, spec_rel)
    if path is None or not path.is_file():
        return None
    try:
        spec = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    thumb = spec.get("thumb") if isinstance(spec, dict) else None
    return thumb if isinstance(thumb, str) and thumb else None


def caches(case: "Case", entity: dict[str, Any]) -> list[str]:
    """The disposable, possibly shared caches this entity points at.

    Dropped when nothing else still uses them, and regenerated on demand — never
    moved aside, so a restore re-queues rather than restores them.
    """
    return _paths(case, entity, travelling=False)


def _drop_cache(case: "Case", rel: str) -> None:
    if any(item.get("thumbnail") == rel for item in case.list_media_items()):
        return  # another media still shows this thumbnail
    path = _resolve(case, rel)
    if path is not None:
        path.unlink(missing_ok=True)


def _remove(path: Path) -> None:
    if path.is_dir():
        shutil.rmtree(path, ignore_errors=True)
    else:
        path.unlink(missing_ok=True)


def refile(case: "Case", entity: dict[str, Any]) -> str | None:
    """File a restored artifact back into whatever index tracks it.

    Today that is the media browse index, whose row a delete unfiled. The
    sidecar travelled with the file, so the row is rebuilt from it rather than
    from anything the trash had to remember. Returns the media path when one was
    refiled, so the caller can re-queue its thumbnail.
    """
    found = _main_path(entity)
    if found is None:
        return None
    kind, main = found
    if not kind.indexed:
        return None
    item = media_engine.read_item(case, main)
    if item is None:
        return None
    case.upsert_media_item(item, entity_id=entity.get("id"))
    return main


def unfile(case: "Case", entity: dict[str, Any]) -> None:
    """Take an artifact out of the indexes and caches that track it, without
    touching the files it owns.

    What a delete does before the files go anywhere — dropped, or moved into the
    trash. The order matters: the caches are read while the sidecar is still
    there, and the browse index row goes before the sharing check, so a
    thumbnail this media was the last user of is actually reclaimed.
    """
    found = _main_path(entity)
    if found is None:
        return
    kind, main = found
    shared = caches(case, entity)
    if kind.indexed:
        case.remove_media_item(main)
    for rel in shared:
        _drop_cache(case, rel)


def delete(case: "Case", entity: dict[str, Any]) -> None:
    """Drop everything an entity owns on disk, leaving the graph alone.

    The hard delete, for an artifact the graph never claimed — a file a tool
    wrote and no entity points at. Anything the graph does hold goes through the
    delete chokepoint instead, which moves the same files into the trash so the
    analyst can take the delete back.
    """
    unfile(case, entity)
    for rel in owned(case, entity):
        path = _resolve(case, rel)
        if path is not None:
            _remove(path)
        case.prune_note_dirs(rel)
