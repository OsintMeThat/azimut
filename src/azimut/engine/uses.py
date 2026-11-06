"""What in a case leans on an entity, read in one place for the two questions that ask it.

Deleting something and asking whether a file is used are one question asked from
opposite ends. The delete dialog lists what leans on its target (`impact`), and the
Media Library's Unused filter keeps the files nothing leans on (`used_refs` here, the
graph half in `store/rows._UNUSED_SQL`). Both read the rules below, so a file the
filter offers as unused is one whose delete warns about nothing, and the other way
round. `tests/test_uses.py` holds the two ends together, and fails on any record in a
full case that names a file without this module reading it or listing why it is not a use.

**In the graph** (ONTOLOGY §3). `links.plan_delete_many` reads the chain: the work
that depends on a target goes with it, and what was derived from it keeps a tombstone.
Past the chain:

- a relation the analyst stated, in either direction: a statement two records share,
  so deleting either end loses it. `same-image-as` is left out. It says a file is a
  duplicate, which is what a clean-up deletes, and enrichment states it on its own.
- a pointer held *at* the target: a note's mention, a claim's subject, place or
  source (`links.POINTER_TYPES`). A pointer the target holds itself goes with it.
- a suggested link is a tool's guess rather than work, and goes without a word.

**Outside the graph**, where a tool names a file or an entity in its own record:

- a plate's picture or video, a collage's pieces, the photo laid over a Horizon view
  or on Horizon's bench, the photo a Horizon search is for, the video a proof states
  its scene in, the captures a scene to geolocate gathered: by media path;
- a personal layer's marker following an entity, a sheet's link, vocabulary word or
  attached file: by entity id;
- an entity's photo chosen from Media (`entity_images`);
- a Detect routine watching an area: by the area's record. The delete refuses that
  one until the routine lets the area go (`api/cases/common.delete_entities_deep`),
  so it is listed as what blocks the delete rather than as what loses a link.

Each record is read field by field, never by sweeping every path it holds. A record
also names what it **made**: Inspect work lists the frames it filed, a collage the
picture it last exported. A sweep would call every extracted frame used, and frames
are what a clean-up is mostly after.
"""

from __future__ import annotations

import json
import threading
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable, Iterable, Iterator

from .. import layout
from ..workspace import CaseError
from . import horizon_finds, horizon_views, inspectwork, mapplates, maplayers, sheets
from . import links as link_engine

if TYPE_CHECKING:
    from ..workspace import Case

#: Per group, the most rows an answer lists. The counts stay exact past it.
LIST_CAP = 100

#: The Horizon bench is the one holder that is not an entity: one per case, never saved.
BENCH_TYPE = "horizon-work"


@dataclass(frozen=True)
class Lean:
    """One record leaning on one target: a media path, a record path or an entity id.

    ``blocks`` is a lean the delete refuses to break rather than one it breaks.
    """

    target: str
    how: str
    blocks: bool = False


# -- records outside the graph --------------------------------------------------------


def _plate(data: dict[str, Any]) -> Iterator[Lean]:
    spec = data.get("spec")
    elements = spec.get("elements") if isinstance(spec, dict) else None
    for element in elements if isinstance(elements, list) else []:
        if not isinstance(element, dict):
            continue
        src = element.get("src")
        kind = element.get("kind")
        if kind in ("image", "video") and isinstance(src, str) and src:
            yield Lean(src, "plays it" if kind == "video" else "shows it")


def _collage(data: dict[str, Any]) -> Iterator[Lean]:
    # `exported` is the picture the collage made, not one it uses: left alone.
    nodes = data.get("nodes")
    for node in nodes if isinstance(nodes, list) else []:
        save = node.get("save") if isinstance(node, dict) else None
        path = save.get("path") if isinstance(save, dict) else None
        if isinstance(path, str) and path:
            yield Lean(path, "uses it as a piece")


def _photo(holder: Any, how: str) -> Iterator[Lean]:
    photo = holder.get("photo") if isinstance(holder, dict) else None
    path = photo.get("path") if isinstance(photo, dict) else None
    if isinstance(path, str) and path:
        yield Lean(path, how)


def _view(data: dict[str, Any]) -> Iterator[Lean]:
    yield from _photo(data.get("spec"), "lays it over the view")


def _bench(data: dict[str, Any]) -> Iterator[Lean]:
    yield from _photo(data, "lays it over the open view")


def _find(data: dict[str, Any]) -> Iterator[Lean]:
    yield from _photo(data.get("ask"), "searches where it was taken")


def _layer(data: dict[str, Any]) -> Iterator[Lean]:
    document = data.get("document")
    features = document.get("features") if isinstance(document, dict) else None
    counts: dict[str, int] = {}
    for feature in features if isinstance(features, list) else []:
        properties = feature.get("properties") if isinstance(feature, dict) else None
        if not isinstance(properties, dict):
            continue
        # `place_id` is the name a link had before any release (`layerediting._spec`).
        target = properties.get("entity_id") or properties.get("place_id")
        if isinstance(target, str) and target:
            counts[target] = counts.get(target, 0) + 1
    for target, count in counts.items():
        yield Lean(target, "1 marker follows it" if count == 1 else f"{count} markers follow it")


def _proof(data: dict[str, Any]) -> Iterator[Lean]:
    # Its panels and material are its chain (`derived-from`), read in the graph.
    scene = data.get("scene")
    video = scene.get("video") if isinstance(scene, dict) else None
    if isinstance(video, str) and video:
        yield Lean(video, "geolocates a scene of it")


def _work(data: dict[str, Any]) -> Iterator[Lean]:
    # Its subject is its chain (`depends-on`), and the frames it filed are what it made.
    for scene in data.get("scenes") or []:
        captures = scene.get("captures") if isinstance(scene, dict) else None
        for path in dict.fromkeys(captures if isinstance(captures, list) else []):
            if isinstance(path, str) and path:
                yield Lean(path, "gathers it for a scene to geolocate")


def _routine(data: dict[str, Any]) -> Iterator[Lean]:
    # The pairs `delete_entities_deep` reads before it refuses to delete an area.
    pairs = data.get("area_dates")
    for pair in pairs if isinstance(pairs, list) else []:
        area = pair.get("area_id") if isinstance(pair, dict) else None
        if isinstance(area, str) and area:
            yield Lean(layout.analysis_rel("areas", area), "watches it", blocks=True)


#: The folders of saved work whose records can lean on something, the records in each,
#: how each is read and what entity type files them. Horizon's folder also holds the
#: bench, read apart.
_FOLDERS: tuple[tuple[str, str, Callable[[dict[str, Any]], Iterator[Lean]], str], ...] = (
    (layout.MAPPLATE_DIR, "*.json", _plate, mapplates.TYPE),
    (layout.COLLAGE_DIR, "*.json", _collage, inspectwork.COLLAGE_TYPE),
    (layout.INSPECT_DIR, "*.json", _work, inspectwork.WORK_TYPE),
    (layout.HORIZON_DIR, "*.json", _view, horizon_views.TYPE),
    (f"{layout.HORIZON_DIR}/{layout.HORIZON_FINDS_DIR}", "*.json", _find, horizon_finds.TYPE),
    (layout.LAYERS_DIR, "*.json", _layer, maplayers.ENTITY_TYPE),
    (f"proofs/{layout.META_DIR}", "*.json", _proof, "proof"),
    (layout.ANALYSIS_DIR, "followups-*.json", _routine, "analysis-follow-up"),
)

# What each record says, kept while the file is unchanged. Bounded, because a long
# session opens many cases; a miss only costs one read.
_CACHE_MAX = 4096
_cache: OrderedDict[str, tuple[tuple[int, int, int], tuple[Lean, ...]]] = OrderedDict()
_cache_lock = threading.Lock()


def _read(path: Path, reader: Callable[[Any], Iterable[Lean]]) -> tuple[Lean, ...]:
    try:
        stat = path.stat()
    except OSError:
        return ()
    key = f"{reader.__name__}\n{path}"
    # The inode too: every save replaces the file whole (`write_json_atomic`), so two
    # saves of one size inside one clock tick still differ by it.
    stamp = (stat.st_mtime_ns, stat.st_size, stat.st_ino)
    with _cache_lock:
        hit = _cache.get(key)
        if hit is not None and hit[0] == stamp:
            _cache.move_to_end(key)
            return hit[1]
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return ()
    leans = tuple(reader(data)) if isinstance(data, dict) else ()
    with _cache_lock:
        _cache[key] = (stamp, leans)
        _cache.move_to_end(key)
        while len(_cache) > _CACHE_MAX:
            _cache.popitem(last=False)
    return leans


def _sheet_leans(meta: Any) -> Iterator[Lean]:
    for target in sheets.pointers(meta):
        yield Lean(target, "links to it")


@dataclass(frozen=True)
class _Holder:
    """Who holds a lean: a record by its path, or a sheet by its entity."""

    rel: str
    type: str
    entity: dict[str, Any] | None = None


def _records(case: "Case") -> Iterator[tuple[_Holder, Lean]]:
    """Every lean held outside the graph, with the record holding it."""
    root = case.tool_root
    for folder, pattern, reader, type_ in _FOLDERS:
        directory = root / folder
        if not directory.is_dir():
            continue
        for path in sorted(directory.glob(pattern)):
            if path.name.startswith("."):
                continue  # the bench, beside the views: read below
            holder = _Holder(f"{folder}/{path.name}", type_)
            for lean in _read(path, reader):
                yield holder, lean
    bench = layout.horizon_work_rel()
    for lean in _read(root / bench, _bench):
        yield _Holder(bench, BENCH_TYPE), lean
    cursor: str | None = None
    while True:
        page = case.page_entities(limit=sheets.SHEET_PAGE, cursor=cursor, types=["sheet"])
        for entity in page.get("items", []):
            try:
                path = sheets.sidecar(case, entity)
            except CaseError:
                continue  # a sheet with no file points at nothing
            for lean in _read(path, _sheet_leans):
                yield _Holder(str(path), "sheet", entity), lean
        cursor = page.get("next_cursor")
        if not cursor:
            return


def used_refs(case: "Case") -> set[str]:
    """Every media path and entity id some record outside the graph leans on."""
    return {lean.target for _holder, lean in _records(case)}


# -- the impact of a delete -----------------------------------------------------------


def _summary(entity: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": entity["id"],
        "type": entity.get("type"),
        "label": entity.get("label"),
        "path": link_engine.artifact_path(entity),
    }


def _verb(link: dict[str, Any], survivor: str) -> str:
    relation = link_engine.relation_type(link["type"])
    if relation is None:
        return link["type"]
    if link["from"] == survivor:
        return relation.label
    return relation.inverse_label or relation.label


def _graph_leans(link: dict[str, Any], doomed: set[str]) -> str | None:
    """The survivor a link leaves losing a statement, or None when the link goes quietly."""
    if link["type"] in link_engine.CHAIN_TYPES or link["type"] == link_engine.SAME_IMAGE_AS:
        return None
    if (link.get("provenance") or {}).get("status", "confirmed") != "confirmed":
        return None
    going_from, going_to = link["from"] in doomed, link["to"] in doomed
    if going_from == going_to:
        return None  # both go, or neither does
    if going_from and link["type"] in link_engine.POINTER_TYPES:
        return None  # the doomed record's own pointer goes with it
    return link["to"] if going_from else link["from"]


def impact(case: "Case", entity_ids: list[str], paths: list[str] | None = None) -> dict[str, Any]:
    """What deleting these entities takes with it, scars, and leaves losing a link.

    ``paths`` are files with no entity (a media file the index never filed): nothing in
    the graph can name them, but a plate or a collage can.

    ``cascade`` and ``tombstone`` are `plan_delete_many`'s. ``touched`` lists every
    other record left losing something, once each, with the ways it does in ``how``.
    ``blocking`` lists what the delete refuses to break: while it holds anything, the
    delete answers 409, so the dialog says so instead of offering it.
    ``counts`` stay exact when a list stops at `LIST_CAP`.
    """
    data = case.snapshot()
    plan = link_engine.plan_delete_many(case, entity_ids, data)
    by_id = {entity["id"]: entity for entity in data["entities"]}
    doomed = set(entity_ids) | {entity["id"] for entity in plan["cascade"]}
    listed = doomed | {entity["id"] for entity in plan["tombstone"]}

    touched: dict[str, dict[str, Any]] = {}
    blocking: dict[str, dict[str, Any]] = {}

    def lean(key: str, row: dict[str, Any], how: str, blocks: bool = False) -> None:
        if key in listed:
            return
        group = blocking if blocks else touched
        held = group.setdefault(key, {**row, "how": []})
        if how not in held["how"]:
            held["how"].append(how)

    for link in data["links"]:
        survivor = _graph_leans(link, doomed)
        if survivor is not None and survivor in by_id:
            lean(survivor, _summary(by_id[survivor]), _verb(link, survivor))

    for row in case.entity_images_touching(sorted(doomed)):
        owner = str(row.get("entity_id") or "")
        if row.get("media_id") in doomed and owner not in doomed and owner in by_id:
            lean(owner, _summary(by_id[owner]), "uses it as a photo")

    targets = set(doomed) | {p for p in paths or [] if p}
    targets |= {path for i in doomed if (path := link_engine.artifact_path(by_id[i]))}
    for holder, held in _records(case):
        if held.target not in targets:
            continue
        entity = holder.entity or case.find_entity(attr="spec", value=holder.rel)
        if entity is not None:
            if entity["id"] in doomed:
                continue
            lean(entity["id"], _summary(entity), held.how, held.blocks)
        elif holder.type == BENCH_TYPE:
            lean(holder.rel, {"id": None, "type": BENCH_TYPE, "label": "Horizon", "path": None}, held.how)
        else:
            # A record never filed as an entity: named after its file.
            label = Path(holder.rel).stem
            row = {"id": None, "type": holder.type, "label": label, "path": holder.rel}
            lean(holder.rel, row, held.how, held.blocks)

    for key in blocking:
        touched.pop(key, None)  # what refuses the delete is said once, as that
    groups = {
        "blocking": list(blocking.values()),
        "cascade": [_summary(entity) for entity in plan["cascade"]],
        "tombstone": [_summary(entity) for entity in plan["tombstone"]],
        "touched": list(touched.values()),
    }
    return {
        **{name: rows[:LIST_CAP] for name, rows in groups.items()},
        "counts": {name: len(rows) for name, rows in groups.items()},
    }
