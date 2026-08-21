"""The vocabulary, served to the frontend.

Relation verbs, graph lenses, confidence levels and entity types: the declarations
in `engine/links.py` and `engine/entities.py` as JSON, so no surface has to keep its
own copy of what the ontology says. Read-only and case-independent, which is why
these paths carry no case id.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from ...engine import entities as entity_engine
from ...engine import graph as graph_engine
from ...engine import links as link_engine
from ...engine import sheetpromote as promote_engine

router = APIRouter(prefix="/api/cases", tags=["cases"])


@router.get("/relation-types")
def relation_types() -> list[dict[str, Any]]:
    """The relation vocabulary (ONTOLOGY §3): how each type reads in words, the
    entity types each end accepts, and whether an analyst may state it.

    Every surface reads this instead of keeping its own copy — the picker offers
    the ``manual`` ones, the relation rows use ``label`` to name an edge. Declared
    above ``/{case_id}`` so the literal path wins.
    """
    return [
        {
            "type": entry.type,
            "label": entry.label,
            "inverse_label": entry.inverse_label or entry.label,
            # one clause saying what the verb means, for the surface that shows it
            "hint": entry.hint,
            # the heading this verb sits under, empty when it sits with the rest
            "group": entry.group,
            # A mention is filed with its own gesture. It is not another wording
            # a relation can turn into after the analyst chose a target.
            "action": entry.action,
            "from_types": sorted(entry.from_types),
            "to_types": sorted(entry.to_types),
            "manual": entry.manual,
            # A mention is a pointer, not a claim to grade. The surface omits the
            # control instead of offering one the model would refuse.
            "ratable": entry.ratable,
            # How a free note on this edge is labelled, empty when the verb takes
            # none — the same shape as `ratable`, and read the same way: a surface
            # draws the field because the verb declares it, never because an edge
            # happens to carry one.
            "qualifier": entry.qualifier,
            "from_media_kinds": sorted(entry.from_media_kinds),
            "to_media_kinds": sorted(entry.to_media_kinds),
        }
        for entry in link_engine.RELATION_TYPES
    ]

@router.get("/graph-lenses")
def graph_lenses() -> dict[str, Any]:
    """The readings the graph offers, and the orderings it ranks by.

    A lens is a set of verbs *and* a set of node roles, and both live in the
    registries, so each one is resolved from them rather than listed again here — a
    verb or a type added there joins its lens with no edit. ``orders`` is the same
    contract as the radius rungs: served, so the picker and the validator cannot drift.

    ``hides`` is the types the reading leaves out of the drawing. Served because the
    surface has to be able to say so *before* asking: a legend row that switches
    nothing and a "bring this in" that the reading will refuse are both controls that
    can only appear to be broken.

    Declared above ``/{case_id}`` so the literal path wins.
    """
    return {
        "lenses": [
            {"id": entry.id, "label": entry.label, "hint": entry.hint,
             "types": list(entry.types), "hides": list(entry.hides)}
            for entry in graph_engine.lenses()
        ],
        "orders": [
            {"value": value, "label": label, "hint": hint}
            for value, label, hint in graph_engine.ORDERS
        ],
        "max_hops": graph_engine.MAX_HOPS,
    }

@router.get("/confidence-levels")
def confidence_levels() -> list[dict[str, Any]]:
    """How sure an edge may say the analyst is (ONTOLOGY §3), coarsest word last.

    Served rather than hardcoded on each surface for the reason the radius rungs are:
    one list, so the picker and the validator cannot drift. **Not assessed is absent
    from this list on purpose** — it is the lack of a rating, not a sixth level, and a
    surface offers it as "clear" rather than as a choice.

    Declared above ``/{case_id}`` so the literal path wins.
    """
    return [
        {"value": value, "label": label, "hint": hint}
        for value, label, hint in link_engine.CONFIDENCE_LEVELS
    ]

@router.get("/entity-types")
def entity_types() -> list[dict[str, Any]]:
    """The entity vocabulary (ONTOLOGY §2): each type's reading, family, icon and
    the fields an analyst may fill on it.

    One registry so a create form is generated rather than written per type, and so
    no screen keeps its own copy. ``manual`` marks the types an analyst creates by
    hand — a ``media`` is born from an import, so it never belongs in a create menu.
    Declared above ``/{case_id}`` so the literal path wins.
    """
    return [
        {
            "type": entry.type,
            "label": entry.label,
            "family": entry.family,
            # what the type is, and what its family is, each in one clause. The
            # vocabulary is terse by design, and a terse word nobody can look up is
            # jargon — so the readings travel with it rather than being written per
            # screen.
            "hint": entry.hint,
            "family_reads": entity_engine.FAMILY_READS.get(entry.family, ""),
            "icon": entry.icon,
            "manual": entry.manual,
            # Whether a sheet row may become one. Not the same question as ``manual``
            # and it drifted the moment it was assumed to be: a ``place`` is never
            # created by hand because it is born from the map, yet a column of
            # coordinates is the other honest way to have one; a ``claim`` is created
            # by hand and a bare row cannot make one, since a statement carries what it
            # is about, when it applies and what it rests on.
            "promotable": entry.type in promote_engine.promotable_types(),
            "image_gallery": entry.image_gallery,
            # ``entity.label`` is the primary value, but "Name" is not an honest
            # reading for an IP address, a phone number or a claim. The generated
            # form names that field from the type instead of duplicating it in attrs.
            "identity_label": entry.identity_label,
            "identity_placeholder": entry.identity_placeholder,
            "attrs": [
                {
                    "key": attr.key,
                    "label": attr.label,
                    "hint": attr.hint,
                    "kind": attr.kind,
                    "editable": attr.editable,
                    # Heads this field and the ones after it that share it; empty
                    # means the field stands on its own label. On the field rather
                    # than on the type because a Claim separates what it states,
                    # when it applies and why it is believed.
                    "group": attr.group,
                    # Served so the form refuses exactly what the API refuses; a
                    # rung list is the shortcut UI, the bounds are the contract.
                    "rungs": [{"label": name, "value": v} for name, v in attr.rungs],
                    "minimum": attr.minimum,
                    "maximum": attr.maximum,
                    # A count steps by one. Served so the spinner and the validator
                    # cannot disagree about what a valid quantity is.
                    "whole": attr.whole,
                    # The whole of a closed field, in scale order. A source's
                    # reliability rides here rather than on a route of its own: it
                    # belongs to the entity, so it travels with the entity registry.
                    "options": [
                        {"value": stored, "label": reading}
                        for stored, reading in attr.options
                    ],
                }
                for attr in entry.attrs
            ],
        }
        for entry in entity_engine.ENTITY_TYPES
    ]
