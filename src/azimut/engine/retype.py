"""Changing what a subject is, without losing anything on the way.

A quick entry guesses a type (`frontend/src/lib/entryLine.js`), and a guess is
sometimes wrong: a unit filed as a person, a handle filed as an organization. The
type is one column, and writing it used to be all a change did, so a change could
leave a subject holding relations its new type cannot hold. Every rule is checked
here, before anything is written, and a change that would lose something is
refused with what stands in the way. The analyst removes it themselves and asks
again: nothing is dropped behind them.

- **Which types.** Between types an analyst makes by hand that own no files, in the
  families that name something (`RETYPE_FAMILIES`). A place is a point and a claim
  is a statement, so neither changes, into or out of.
- **Relations.** Every relation touching the subject is checked against the new
  type, as `links.set_relation_type` checks a verb that changes.
- **Photos.** A type with no gallery cannot take a subject that has photos.
- **Fields.** Kept. A value the new type does not declare stays in ``attrs``, where
  Details shows it as kept from the earlier type; changing back makes it editable
  again. A declared value the new type reads differently is refused.
- **Identity.** Into an identifier, a value the case already holds is reported, and
  never refused: two records of one value are a merge to make, not an error.
"""

from __future__ import annotations

from typing import Any

from ..repository import CaseRepository
from ..workspace import CaseError
from . import artifacts as artifact_engine
from . import entities as entity_engine
from . import links as link_engine

#: The families whose types can change into one another.
RETYPE_FAMILIES = frozenset({
    entity_engine.ACTOR, entity_engine.ASSET, entity_engine.CLASS, entity_engine.IDENTIFIER,
})


def retypable(type_: str) -> bool:
    """Whether a subject of this type can change type, and be changed into it."""
    entry = entity_engine.entity_type(type_)
    return (
        entry is not None
        and entry.manual
        and entry.family in RETYPE_FAMILIES
        and type_ in artifact_engine.NO_FILES
    )


def _a(word: str) -> str:
    """The word with its article, as a reason is read aloud: an account, a person."""
    return f"{'an' if word[:1] in 'aeiou' else 'a'} {word}"


def _reading(entity: dict[str, Any]) -> str:
    return f"“{entity.get('label') or entity.get('id')}”"


def problems(case: CaseRepository, entity: dict[str, Any], new_type: str) -> list[str]:
    """What stands in the way of this entity becoming a ``new_type``, one line each.

    Empty when the change can go ahead. Nothing is written either way.
    """
    old_type = str(entity["type"])
    if new_type == old_type:
        return []
    new_entry = entity_engine.entity_type(new_type)
    if new_entry is None:
        return [f"'{new_type}' is not a type this case knows"]
    reasons: list[str] = []
    if not retypable(old_type):
        old_entry = entity_engine.entity_type(old_type)
        reasons.append(f"{_a(old_entry.label.lower() if old_entry else old_type)} keeps its type")
    if not retypable(new_type):
        reasons.append(f"nothing can become {_a(new_entry.label.lower())}")
    if reasons:
        return reasons

    changed = {**entity, "type": new_type}
    for link in case.links_of(str(entity["id"])):
        spec = link_engine.relation_type(link["type"])
        if spec is None:
            reasons.append(f"it is joined by '{link['type']}', which only a tool writes")
            continue
        ours_from = link["from"] == entity["id"]
        other_id = link["to"] if ours_from else link["from"]
        other = changed if other_id == entity["id"] else case.get_entity(other_id)
        if other is None:
            continue
        source, target = (changed, other) if ours_from else (other, changed)
        if source["type"] not in spec.from_types or target["type"] not in spec.to_types:
            verb = spec.label
            reasons.append(
                f"it {verb} {_reading(target)}" if ours_from
                else f"{_reading(source)} {verb} it"
            )

    if not new_entry.image_gallery:
        photos = len(case.entity_images(str(entity["id"])))
        if photos:
            reasons.append(
                f"{_a(new_entry.label.lower())} has no photos, and this one has {photos}"
            )

    attrs = entity.get("attrs") or {}
    try:
        entity_engine.check_attrs(new_type, attrs, current=attrs)
    except CaseError as exc:
        reasons.append(f"a field does not fit {_a(new_entry.label.lower())}: {exc}")
    return reasons


def twin(case: CaseRepository, entity: dict[str, Any], new_type: str) -> dict[str, Any] | None:
    """The entity already holding this value as a ``new_type`` identifier, or None."""
    key = entity_engine.identity_key(new_type, str(entity.get("label") or ""))
    if not key:
        return None
    for entity_id, label in case.labels_of_type(new_type):
        if entity_id != entity["id"] and entity_engine.identity_key(new_type, label) == key:
            return case.get_entity(entity_id)
    return None


def retained_fields(entity: dict[str, Any], new_type: str, patch: dict[str, Any]) -> dict[str, Any]:
    """Remember the source type of fields kept outside the new type's editor."""
    attrs = {**entity.get("attrs", {}), **patch}
    old = entity_engine.entity_type(entity["type"])
    new = entity_engine.entity_type(new_type)
    declared = {field.key for field in new.attrs} if new else set()
    held = dict(attrs.get("_retained_fields") or {})
    for field in old.attrs if old else ():
        if field.key not in declared and attrs.get(field.key) not in (None, ""):
            held.setdefault(field.key, entity["type"])
    held = {key: type_ for key, type_ in held.items() if key not in declared and attrs.get(key) not in (None, "")}
    return {**patch, "_retained_fields": held or None}
