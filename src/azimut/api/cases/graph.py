"""The case drawn: a bounded view, a neighbourhood, the routes between two nodes.

Placement is the frontend's (`lib/graph.js`); what these serve is which nodes and
edges a reading holds, which is `engine/graph.py`. The pins are the other half —
where the analyst put a node by hand, kept per lens.
"""

from __future__ import annotations

import sqlite3
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from ...engine import artifacts as artifact_engine
from ...engine import graph as graph_engine
from ...workspace import Case, CaseError
from .common import _temporal_filter_args, get_case

router = APIRouter(prefix="/api/cases", tags=["cases"])


class GraphPin(BaseModel):
    """One node and where it was dropped, in the graph's own canvas units.

    Bounded because a coordinate arrives from a pointer and nothing downstream
    clamps it: the layout would happily place a node at 1e300 and the view would
    then scale the whole case down to a dot trying to frame it.
    """

    id: str = Field(min_length=1, max_length=64)
    x: float = Field(ge=-1_000_000, le=1_000_000)
    y: float = Field(ge=-1_000_000, le=1_000_000)

class GraphPins(BaseModel):
    #: Which reading was being arranged. An arrangement belongs to one, because a
    #: lens draws its own nodes and clusters them its own way.
    lens: str = Field(min_length=1, max_length=40)
    #: One drag, or the batch a debounce collected. Capped at the view's own node
    #: ceiling: nothing can be arranged that was never drawn.
    pins: list[GraphPin] = Field(min_length=1, max_length=graph_engine.MAX_OPENING)

def _ids(value: str | None) -> list[str] | None:
    """One of the graph's comma-separated id lists, or nothing at all.

    ``None`` rather than an empty list when nothing was sent, because the engine
    tells "no list" from "an empty one" and answers the first by not asking.
    """
    if not value:
        return None
    named = [entity_id.strip() for entity_id in value.split(",") if entity_id.strip()]
    return named or None

@router.get("/{case_id}/graph")
def graph_view(
    case_id: str,
    lens: str = "all",
    limit: int | None = None,
    order: str = "degree",
    type: str | None = None,
    status: str | None = None,
    q: str | None = None,
    folder: str | None = None,
    unfiled: bool = False,
    recursive: bool = False,
    attr: str | None = None,
    value: str | None = None,
    linked: str | None = None,
    unlinked: bool = False,
    since: str | None = None,
    until: str | None = None,
    by: str | None = None,
    temporal_from: str | None = None,
    temporal_to: str | None = None,
    temporal_category: str | None = None,
    keep: str | None = None,
    expand: str | None = None,
    omit: str | None = None,
    view: str | None = None,
) -> dict[str, Any]:
    """The whole case as one bounded graph — the view the graph opens on.

    A case is a subject before it is a set of statements, so this is the entry
    point and expansion is the drill-down, not the other way round. ``order``
    decides which nodes a case too large to draw keeps: the hubs, or the latest
    work. **The catalog's whole filter vocabulary narrows it** — down to the stored
    field, the one-hop test and the date it was filed — so the board and the graph
    cannot disagree about what "confirmed people in this folder, added this week"
    means, and a question asked in the table can be handed to the drawing as itself
    rather than as a list of ids that goes stale on the next save.

    Three comma-separated lists then edit that set, and the drawing is whatever they
    say it is. ``keep`` draws these nodes and nothing around them; ``expand`` draws
    these and one hop, which is what lets the analyst follow a thread without losing
    the case they were reading it in; ``omit`` leaves these out, whichever of the
    three put them there. Ids the case does not hold are skipped rather than refused —
    a drawing races a delete made in another tab.
    """
    case = get_case(case_id)
    if view:
        saved = case.get_analysis_view(view)
        if saved is None:
            raise HTTPException(status_code=404, detail=f"analysis view '{view}' not found")
        if saved["mode"] == "snapshot":
            try:
                return graph_engine.snapshot_view(
                    saved["spec"]["snapshot"], lens_id=lens, query=q
                )
            except CaseError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
    types = [t.strip() for t in type.split(",") if t.strip()] if type else None
    filed_by = [name.strip() for name in by.split(",") if name.strip()] if by else None
    temporal_since, temporal_until, temporal_categories = _temporal_filter_args(
        temporal_from, temporal_to, temporal_category
    )
    try:
        payload = graph_engine.view(
            case, lens_id=lens, limit=limit, types=types, status=status,
            query=q, folder=folder, unfiled=unfiled, recursive=recursive, order=order,
            attr=attr, attr_value=value, linked=linked, unlinked=unlinked,
            since=since, until=until, filed_by=filed_by,
            temporal_since=temporal_since, temporal_until=temporal_until,
            temporal_categories=temporal_categories,
            keep=_ids(keep), expand=_ids(expand), omit=_ids(omit),
        )
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    _adopt_spec_previews(case, payload)
    return payload

@router.get("/{case_id}/graph/neighborhood")
def graph_neighborhood(
    case_id: str,
    root: str,
    lens: str = "all",
    hops: int = 1,
    limit: int | None = None,
) -> dict[str, Any]:
    """One node and what surrounds it, for a question that does have a root.

    Every node carries its degree in this lens, so the analyst sees what a further
    expansion costs before paying it, and ``truncated`` says when the node budget
    ended the walk rather than the graph doing so.
    """
    case = get_case(case_id)
    try:
        payload = graph_engine.neighborhood(
            case, root, lens_id=lens, hops=hops, limit=limit
        )
    except CaseError as exc:
        detail = str(exc)
        status_code = 404 if "not found" in detail else 400
        raise HTTPException(status_code=status_code, detail=detail) from exc
    _adopt_spec_previews(case, payload)
    return payload

@router.get("/{case_id}/graph/paths")
def graph_paths(
    case_id: str,
    from_id: str = Query(alias="from"),
    to_id: str = Query(alias="to"),
    lens: str = "all",
    hops: int = graph_engine.MAX_PATH_HOPS,
) -> dict[str, Any]:
    """Every shortest route between two entities, or the fact that there is none.

    A read, and the one question the graph existed without: the case answers "what
    touches this" a hop at a time, where an investigation asks "how does this reach
    that". ``found: false`` is an answer rather than an error — learning that two
    entities are *not* connected within the budget is a finding about the case.

    ``from`` and ``to`` are query names rather than argument names because ``from``
    is a Python keyword, and the URL is the vocabulary the client reads.
    """
    case = get_case(case_id)
    try:
        return graph_engine.paths(case, from_id, to_id, lens_id=lens, max_hops=hops)
    except CaseError as exc:
        detail = str(exc)
        status_code = 404 if "not found" in detail else 400
        raise HTTPException(status_code=status_code, detail=detail) from exc

def _lens_id(lens: str) -> str:
    """The lens an arrangement belongs to, refused if the registry does not know it.

    Checked at the edge like every other lens: an unrecognised one would file pins
    under a reading nothing can ever draw, where they would sit in the case forever
    with no surface able to show or clear them.
    """
    try:
        return graph_engine.lens(lens).id
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

@router.put("/{case_id}/graph/pins")
def pin_graph_nodes(case_id: str, body: GraphPins) -> dict[str, Any]:
    """Record where nodes were dragged to, so the arrangement survives a reload.

    Filed against the lens they were arranged in: a lens draws its own nodes and
    clusters them its own way, so one shared arrangement would anchor every reading
    into the shape of whichever one it was built in.

    The whole batch in one transaction: a drag that moved several nodes is one
    act, and half of it landing would leave an arrangement nobody chose. Writing a
    pin asserts nothing about the case — it is where a hand put a dot — which is
    why it never touches the entity or its provenance.
    """
    case = get_case(case_id)
    lens = _lens_id(body.lens)
    case.pin_entities(lens, {pin.id: (pin.x, pin.y) for pin in body.pins})
    return {"lens": lens, "pinned": len(case.graph_pins(lens))}

@router.delete("/{case_id}/graph/pins/{entity_id}")
def unpin_graph_node(case_id: str, entity_id: str, lens: str = "all") -> dict[str, Any]:
    """Hand one node back to the computed layout, in this lens."""
    case = get_case(case_id)
    reading = _lens_id(lens)
    case.unpin_entities(reading, [entity_id])
    return {"lens": reading, "pinned": len(case.graph_pins(reading))}

@router.delete("/{case_id}/graph/pins")
def unpin_graph(case_id: str, lens: str = "all") -> dict[str, Any]:
    """Drop this lens's arrangement: the reading goes back to the placement it
    computes, and the other readings keep theirs.

    The way out of an arrangement that stopped helping. It is offered because the
    pins are saved as they are made — an autosave with no way back is a trap.
    """
    case = get_case(case_id)
    reading = _lens_id(lens)
    case.clear_graph_pins(reading)
    return {"lens": reading, "pinned": 0}

def _adopt_spec_previews(case: Case, payload: dict[str, Any]) -> None:
    """Give a node the preview its own spec file has been keeping to itself.

    A proof records its thumbnail in ``proofs/.meta/<name>.json``, and the graph
    answers from the database alone — that boundary is what keeps a graph read one
    query instead of a walk of the case, so it is not the place to open files. This
    copies the path across, **once per proof, ever**: the first view that draws one
    reads its spec, records it on the entity, and every later view finds it on the row
    like any other preview. A proof saved from now on carries it from the start.
    """
    for node in payload.get("nodes", []):
        if node.get("thumb") or node.get("type") != "proof":
            continue
        entity = case.get_entity(node["id"])
        thumb = artifact_engine.spec_thumb(case, entity) if entity else None
        if not thumb:
            continue
        node["thumb"] = thumb
        try:
            case.update_entity(node["id"], {"attrs": {"thumb": thumb}})
        except (CaseError, sqlite3.Error):
            # The copy is an optimisation, not the answer: a background import or
            # a mass delete holding the write lock past `busy_timeout` must not
            # turn a read of the graph into an error. The node already carries
            # what it needs, and the next draw tries the copy again.
            pass
