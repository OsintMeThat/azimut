"""What a delete would touch, asked before it is pressed.

Every delete dialog reads this one route, whatever the tool, so the analyst always
learns what else the click reaches before making it (`engine/uses.impact`). It names
its targets the way the deletes do: an entity by id, a file or a record by its path,
and the saved work a tool deletes by name by that tool and name, through the same
helper its delete route reads, so the preview is of the file the delete will take.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..engine import analyzers as analyzers_engine
from ..engine import inspectwork
from ..engine import uses as uses_engine
from ..workspace import Case, CaseError
from . import compare, drafts, horizon_finds, inspect, mapplates
from .cases import get_case
from .cases.common import entity_at

router = APIRouter(prefix="/api", tags=["cases"])

#: One act deletes a selection at most this large in one preview.
MAX_TARGETS = 1000

Tool = Literal[
    "collage", "plate", "draft", "comparison", "find", "inspect", "areas", "zones", "followups", "runs",
]
#: Detect's saved work, named by its kind and its id (`api/analyzers.delete_item`).
DETECT_KINDS = ("areas", "zones", "followups", "runs")


class NamedIn(BaseModel):
    """Saved work its tool deletes by name. ``inspect`` names the file its work is on,
    and Detect's kinds name their record by its id."""

    tool: Tool
    name: str = Field(min_length=1, max_length=1000)


class ImpactIn(BaseModel):
    """The targets of one delete: by id, by path, or by a tool's own name for its work."""

    ids: list[Annotated[str, Field(min_length=1, max_length=200)]] = Field(
        default_factory=list, max_length=MAX_TARGETS
    )
    paths: list[Annotated[str, Field(min_length=1, max_length=1000)]] = Field(
        default_factory=list, max_length=MAX_TARGETS
    )
    named: list[NamedIn] = Field(default_factory=list, max_length=MAX_TARGETS)


def _named_rel(case: Case, named: NamedIn) -> str | None:
    if named.tool == "inspect":
        return inspectwork.work_rel(case, named.name)
    if named.tool in DETECT_KINDS:
        try:
            return analyzers_engine.relpath(named.tool, named.name)
        except ValueError as exc:  # not the shape of a Detect id: nothing by that name
            raise CaseError(str(exc)) from exc
    spec = {
        "collage": inspect.collage_spec,
        "plate": mapplates.plate_spec,
        "draft": drafts.draft_spec,
        "comparison": compare.session_spec,
        "find": horizon_finds.find_spec,
    }[named.tool]
    return spec(named.name)


@router.post("/cases/{case_id}/delete-impact")
def delete_impact(case_id: str, body: ImpactIn) -> dict[str, Any]:
    """What deleting these targets takes with it, scars, and leaves losing a link.

    A path nothing is filed under is kept as a path: no entity points at it, but a
    plate or a collage still can.
    """
    case = get_case(case_id)
    ids = list(body.ids)
    loose: list[str] = []
    try:
        rels = [*body.paths, *(_named_rel(case, named) for named in body.named)]
        for rel in rels:
            if not rel:
                continue
            entity = entity_at(case, rel)
            if entity is None:
                loose.append(rel)
            else:
                ids.append(entity["id"])
        return uses_engine.impact(case, list(dict.fromkeys(ids)), loose)
    except CaseError as exc:  # an unknown id, or a name nothing is saved under
        raise HTTPException(status_code=404, detail=str(exc)) from exc
