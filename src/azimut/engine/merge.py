"""Folding one subject into another: two records the analyst says are one thing.

Quick entry makes duplicates cheap, so this makes them cheap to fix. It is always
the analyst's gesture and never automatic: a name is not an identity, and the app
proposes a duplicate at most (`/entities/twin`), it never folds one.

**What can merge.** Two entities of one type, in the families that name something
(`MERGE_FAMILIES`): people, groups, objects, models, identifiers, places. Not files
(`same-image-as` says two files are one picture), not claims (two observations of
one thing stay two observations), not documents. Two types are two questions:
change one type first (`engine/retype.py`).

**What the survivor keeps.** Its own values. A field it leaves empty takes the other
one's value; a field both fill differently keeps the survivor's, and the other value
goes into the notes, attributed. The absorbed name goes into the other names when
the type declares them, into the notes otherwise. Either being confirmed confirms
the survivor, since the merge is the analyst's own act.

**What moves** is in `store/merges.py`, one transaction; the sheets' sidecars follow
once it has committed. The absorbed id keeps answering through a redirect
(``entity_redirects``), so a note, a frozen view or a Trash restore naming it lands
on the survivor, and the merge record undoes it all while it exists. A bundle keeps
the redirects and leaves the records behind, as it does the Trash.
"""

from __future__ import annotations

import json
from typing import Any

from ..workspace import Case, CaseError
from . import entities as entity_engine
from .textfold import fold_text
from . import satellite as satellite_engine
from . import sheets as sheet_engine

#: The families whose entities can be folded together.
MERGE_FAMILIES = frozenset({
    entity_engine.ACTOR, entity_engine.ASSET, entity_engine.CLASS,
    entity_engine.IDENTIFIER, entity_engine.PLACE,
})

#: Fields a merge settles by its own rules rather than as an ordinary value.
_OWN_RULES = frozenset({"notes", "aliases", "folder", "_retained_fields", satellite_engine.COORD_KEY})


def refusals(survivor: dict[str, Any] | None, other: dict[str, Any] | None) -> list[str]:
    """Why these two cannot merge, one line each; empty when they can."""
    if survivor is None or other is None:
        return ["both entities have to be in the case"]
    if survivor["id"] == other["id"]:
        return ["an entity cannot be merged into itself"]
    reasons: list[str] = []
    if survivor["type"] != other["type"]:
        reasons.append("two different types: change one type first")
    entry = entity_engine.entity_type(str(survivor["type"]))
    if entry is None or entry.family not in MERGE_FAMILIES:
        label = entry.label.lower() if entry else survivor["type"]
        reasons.append(f"a {label} is never merged")
    return reasons


def _declared(type_: str) -> dict[str, entity_engine.Attr]:
    entry = entity_engine.entity_type(type_)
    return {attr.key: attr for attr in entry.attrs} if entry else {}


def _shown(value: Any) -> str:
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    return str(value)


def _filled(value: Any) -> bool:
    return value is not None and value != "" and value != [] and value != {}


def _names(value: Any) -> list[str]:
    return [part.strip() for part in str(value or "").replace("\n", ";").replace(",", ";").split(";") if part.strip()]


def combine(survivor: dict[str, Any], other: dict[str, Any]) -> dict[str, Any]:
    """What the survivor holds after the merge, and how each field was settled.

    Pure: ``{attrs, status, old_key, kept, added, conflicts}``. ``kept`` are the
    survivor's own values, ``added`` fill a field it left empty, ``conflicts`` are
    the other's differing values, written into the notes.
    """
    ours: dict[str, Any] = dict(survivor.get("attrs") or {})
    theirs: dict[str, Any] = dict(other.get("attrs") or {})
    declared = _declared(str(survivor["type"]))
    attrs = dict(ours)
    added: dict[str, Any] = {}
    conflicts: list[dict[str, Any]] = []
    for key, value in theirs.items():
        if key in _OWN_RULES or not _filled(value):
            continue
        if not _filled(ours.get(key)):
            attrs[key] = value
            added[key] = value
        elif ours[key] != value:
            label = declared[key].label if key in declared else key
            conflicts.append({"key": key, "label": label, "kept": ours[key], "other": value})

    if not _filled(ours.get("folder")) and _filled(theirs.get("folder")):
        attrs["folder"] = theirs["folder"]
        added["folder"] = theirs["folder"]

    old_key = theirs.get(satellite_engine.COORD_KEY) or None
    if not old_key and survivor["type"] == "place" and theirs.get("lat") is not None and theirs.get("lon") is not None:
        old_key = satellite_engine.coord_key(theirs["lat"], theirs["lon"])
    retained = {**(theirs.get("_retained_fields") or {}), **(ours.get("_retained_fields") or {})}
    if retained:
        attrs["_retained_fields"] = retained

    lines: list[str] = []
    other_label = str(other.get("label") or "")
    alias_values = _names(ours.get("aliases"))
    if "aliases" in declared:
        for name in [other_label, *_names(theirs.get("aliases"))]:
            if name and fold_text(name) != fold_text(str(survivor.get("label") or "")) and fold_text(name) not in {
                fold_text(alias) for alias in alias_values
            }:
                alias_values.append(name)
        if alias_values != _names(ours.get("aliases")):
            attrs["aliases"] = "; ".join(alias_values)
            added["aliases"] = attrs["aliases"]
    elif fold_text(other_label) != fold_text(str(survivor.get("label") or "")):
        lines.append(f"Also filed as: {other_label}")

    # Other names retained after a type change are still case data.
    if "aliases" not in declared and _filled(theirs.get("aliases")):
        if not _filled(ours.get("aliases")):
            attrs["aliases"] = theirs["aliases"]
            added["aliases"] = theirs["aliases"]
        elif ours["aliases"] != theirs["aliases"]:
            conflicts.append({"key": "aliases", "label": "Other names", "kept": ours["aliases"], "other": theirs["aliases"]})

    theirs_notes = str(theirs.get("notes") or "").strip()
    ours_notes = str(ours.get("notes") or "").strip()
    if theirs_notes and theirs_notes not in ours_notes:
        lines.append(f"From {other_label}: {theirs_notes}")
    for conflict in conflicts:
        lines.append(f"From {other_label}, {conflict['label']}: {_shown(conflict['other'])}")
    if lines:
        attrs["notes"] = "\n\n".join(part for part in (ours_notes, "\n".join(lines)) if part)

    confirmed = "confirmed" in (
        survivor.get("provenance", {}).get("status"), other.get("provenance", {}).get("status")
    )
    status = "confirmed" if confirmed else str(survivor.get("provenance", {}).get("status") or "confirmed")
    if attrs.get("notes") != ours.get("notes"):
        added["notes"] = attrs["notes"]
    entity_engine.check_attrs(str(survivor["type"]), attrs, current=ours)
    kept = {key: value for key, value in ours.items() if key not in added}
    return {
        "attrs": attrs,
        "status": status,
        "old_key": old_key,
        "kept": kept,
        "added": added,
        "conflicts": conflicts,
    }


def _notes_naming(case: Case, entity_id: str) -> int:
    """How many notes mention this entity in their text. Read, never rewritten: the
    text is the analyst's, and the redirect resolves it."""
    token = f"[[entity:{entity_id}|"
    count = 0
    cursor: str | None = None
    while True:
        page = case.page_entities(limit=200, cursor=cursor, types=["note"])
        for note in page.get("items", []):
            path = (note.get("attrs") or {}).get("path")
            if not path:
                continue
            try:
                text = case.resolve_inside(str(path)).read_text(encoding="utf-8")
            except (CaseError, OSError, ValueError):
                continue
            count += token in text
        cursor = page.get("next_cursor")
        if not cursor:
            return count


def _sidecar(case: Case, sheet: dict[str, Any]) -> dict[str, Any] | None:
    try:
        _, meta_path = sheet_engine._paths(case, sheet)
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except (CaseError, OSError, ValueError):
        return None
    return meta if isinstance(meta, dict) else None


def _sheets_naming(case: Case, entity_id: str) -> int:
    count = 0
    cursor: str | None = None
    while True:
        page = case.page_entities(limit=sheet_engine.SHEET_PAGE, cursor=cursor, types=["sheet"])
        for sheet in page.get("items", []):
            meta = _sidecar(case, sheet)
            if meta is not None and entity_id in sheet_engine.linked_entity_ids(meta):
                count += 1
        cursor = page.get("next_cursor")
        if not cursor:
            return count


def _checked(case: Case, survivor_id: str, other_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
    survivor, other = case.get_entity(survivor_id), case.get_entity(other_id)
    reasons = refusals(survivor, other)
    if reasons:
        raise CaseError("; ".join(reasons))
    assert survivor is not None and other is not None
    return survivor, other


def preview(case: Case, survivor_id: str, other_id: str) -> dict[str, Any]:
    """What merging `other_id` into `survivor_id` would do, written nowhere.

    The database half is the merge itself, rolled back; the sheets and notes that
    name the absorbed entity are counted from disk.
    """
    survivor, other = _checked(case, survivor_id, other_id)
    fields = combine(survivor, other)
    report = case.merge_entities(
        survivor_id, other_id,
        survivor_attrs=fields["attrs"], survivor_status=fields["status"],
        old_key=fields["old_key"], by="user", dry_run=True,
    )
    return {
        "survivor": survivor,
        "other": other,
        "fields": {key: fields[key] for key in ("kept", "added", "conflicts")},
        "links": report["links"],
        "refused": report["refused"],
        "images": report["images"],
        "pins": report["pins"],
        "views": report["views"],
        "sheets": _sheets_naming(case, other_id),
        "notes": _notes_naming(case, other_id),
    }


def merge(case: Case, survivor_id: str, other_id: str, *, by: str = "user") -> dict[str, Any]:
    """Fold `other_id` into `survivor_id`. Returns the report and the merge id."""
    with case.lock:
        survivor, other = _checked(case, survivor_id, other_id)
        fields = combine(survivor, other)
        recover(case)
        if case.pending_merge_work():
            raise CaseError("a previous merge still needs to update a sheet; make it writable first")
        sheets = sheet_engine.plan_entity_move(case, other_id, survivor_id)
        with case.batch():
            report = case.merge_entities(
                survivor_id, other_id,
                survivor_attrs=fields["attrs"], survivor_status=fields["status"],
                old_key=fields["old_key"], by=by,
            )
            case.set_merge_sheets(report["merge"], sheets)
        warnings = recover(case)
        return {**report, "sheets": len(sheets), "warnings": warnings, "fields": {k: fields[k] for k in ("added", "conflicts")}}


def undo(case: Case, merge_id: str) -> dict[str, Any]:
    """Undo database changes once; replay sidecars from the durable journal."""
    with case.lock:
        recover(case)
        if case.pending_merge_work():
            raise CaseError("a previous merge still needs to update a sheet; make it writable first")
        result = case.unmerge(merge_id)
        lost = [*result["lost"], *recover(case)]
        return {"restored": result["restored"], "survivor": result["survivor"], "lost": lost}


def recover(case: Case) -> list[str]:
    """Finish interrupted sidecar writes on case open, including interrupted Undo."""
    warnings: list[str] = []
    with case.lock:
        for record in case.pending_merge_work():
            payload = record["payload"]
            lost, retry = sheet_engine.apply_entity_move(case, payload.get("sheets", []), undo=bool(payload.get("undo_result")))
            warnings.extend(lost)
            if not retry:
                case.finish_merge_work(record["id"])
    return warnings


def resolve(case: Case, entity_id: str) -> tuple[str, dict[str, str] | None]:
    """The id an entity answers to now, and where it came from when it was absorbed."""
    redirect = case.entity_redirects([entity_id]).get(entity_id)
    if redirect is None:
        return entity_id, None
    return str(redirect["id"]), {"id": entity_id, "label": str(redirect["label"])}
