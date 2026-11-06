"""Named, case-owned Board, Graph and Timeline readings."""

from __future__ import annotations

import io
import uuid
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from PIL import Image
from pydantic import BaseModel, Field

from .. import errors
from ..engine import analysis_views as view_engine
from ..engine import media as media_engine
from ..engine import snapshots
from ..engine import trash as trash_engine
from ..workspace import CaseError
from .cases import get_case
from .plates import MAX_PNG_BYTES, _clean_png

router = APIRouter(
    prefix="/api/cases/{case_id}/analysis-views", tags=["analysis views"]
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


class AnalysisViewIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    mode: Literal["live", "snapshot"] = "live"
    surface: Literal["board", "graph", "timeline"] = "board"
    spec: dict[str, Any] = Field(default_factory=dict)


#: The body of a figure: its picture as base64, and the recipe of the reading it shows.
MAX_FIGURE_BODY_BYTES = MAX_PNG_BYTES * 4 // 3 + view_engine.MAX_SPEC_BYTES + 1_000_000
#: What a figure's media file records about the reading it shows, in its sidecar and on its entity.
FIGURE_SOURCE = "analysis-view"
FIGURE_VIEW_ATTR = "analysis_view"
FIGURE_SURFACE_ATTR = "analysis_surface"


class AnalysisViewDuplicateIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class AnalysisViewRenameIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)


def _unique(case, name: str, surface: str, *, ignore: str | None = None) -> None:
    """A name is claimed inside its own family, not across the app: the Timeline's
    views and the catalog's are separate lists, and refusing a name the user cannot
    see anywhere is worse than allowing the repeat."""
    wanted = name.strip().casefold()
    wanted_family = view_engine.family(surface)
    if any(
        view["id"] != ignore
        and view_engine.family(view.get("surface")) == wanted_family
        and str(view["name"]).strip().casefold() == wanted
        for view in case.list_analysis_views()
    ):
        raise HTTPException(status_code=409, detail=f"an analysis view named '{name}' already exists")


def _save(
    case,
    view_id: str,
    body: AnalysisViewIn,
    *,
    created_at: str,
    snapshot_copy: bool = False,
) -> dict[str, Any]:
    name = body.name.strip()
    _unique(case, name, body.surface, ignore=view_id)
    try:
        spec = view_engine.prepare(
            case,
            body.spec,
            mode=body.mode,
            surface=body.surface,
            snapshot_copy=snapshot_copy,
        )
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    now = _now()
    return case.save_analysis_view({
        "id": view_id,
        "name": name,
        "mode": body.mode,
        "surface": body.surface,
        "spec": spec,
        "created_at": created_at,
        "updated_at": now,
    })


@router.get("")
def list_analysis_views(case_id: str) -> dict[str, Any]:
    case = get_case(case_id)
    return {"views": [view_engine.summary(view) for view in case.list_analysis_views()]}


@router.post("")
def create_analysis_view(case_id: str, body: AnalysisViewIn) -> dict[str, Any]:
    case = get_case(case_id)
    now = _now()
    return _save(case, f"v_{uuid.uuid4().hex[:16]}", body, created_at=now)


@router.get("/{view_id}")
def get_analysis_view(case_id: str, view_id: str) -> dict[str, Any]:
    view = get_case(case_id).get_analysis_view(view_id)
    if view is None:
        raise HTTPException(status_code=404, detail=f"analysis view '{view_id}' not found")
    return view


@router.post("/{view_id}/duplicate")
def duplicate_analysis_view(
    case_id: str, view_id: str, body: AnalysisViewDuplicateIn
) -> dict[str, Any]:
    case = get_case(case_id)
    current = case.get_analysis_view(view_id)
    if current is None:
        raise HTTPException(status_code=404, detail=f"analysis view '{view_id}' not found")
    now = _now()
    duplicate = AnalysisViewIn(
        name=body.name,
        mode=current["mode"],
        surface=current["surface"],
        spec=current["spec"],
    )
    return _save(
        case,
        f"v_{uuid.uuid4().hex[:16]}",
        duplicate,
        created_at=now,
        snapshot_copy=True,
    )


@router.patch("/{view_id}")
def rename_analysis_view(
    case_id: str, view_id: str, body: AnalysisViewRenameIn
) -> dict[str, Any]:
    """Rename one reading, whatever it holds.

    A snapshot refuses `PUT` because its capture is evidence, but its label is not:
    renaming is the one edit both modes accept, and it leaves the spec untouched. The
    answer is the menu row rather than the whole view, so relabelling a large capture
    does not ship it back.
    """
    case = get_case(case_id)
    current = case.get_analysis_view(view_id)
    if current is None:
        raise HTTPException(status_code=404, detail=f"analysis view '{view_id}' not found")
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="an analysis view needs a name")
    _unique(case, name, current["surface"], ignore=view_id)
    renamed = case.rename_analysis_view(view_id, name, _now())
    if renamed is None:  # pragma: no cover - the read above is the invariant
        raise HTTPException(status_code=404, detail=f"analysis view '{view_id}' not found")
    return view_engine.summary(renamed)


@router.put("/{view_id}")
def update_analysis_view(
    case_id: str, view_id: str, body: AnalysisViewIn
) -> dict[str, Any]:
    case = get_case(case_id)
    current = case.get_analysis_view(view_id)
    if current is None:
        raise HTTPException(status_code=404, detail=f"analysis view '{view_id}' not found")
    if current["mode"] == "snapshot":
        raise HTTPException(status_code=409, detail="a snapshot is immutable; duplicate it instead")
    return _save(case, view_id, body, created_at=current["created_at"])


@router.delete("/{view_id}")
def delete_analysis_view(case_id: str, view_id: str) -> dict[str, Any]:
    case = get_case(case_id)
    view = case.get_analysis_view(view_id)
    if view is None:
        raise HTTPException(status_code=404, detail=f"analysis view '{view_id}' not found")
    group = trash_engine.send_analysis_view(case, view)
    try:
        case.remove_analysis_view(view_id)
        trash_engine.commit(case, group["id"])
    except Exception:
        trash_engine.rollback(case, group["id"])
        raise
    return {"status": "deleted", "deleted": [view_id], "trash": group["id"]}


class FigureIn(BaseModel):
    """A Graph or a Timeline reading as a picture, and the snapshot that freezes it."""

    name: str = Field(min_length=1, max_length=80)
    surface: Literal["graph", "timeline"]
    spec: dict[str, Any] = Field(default_factory=dict)
    png: str = Field(min_length=1, max_length=MAX_FIGURE_BODY_BYTES)
    filename: str = Field(min_length=1, max_length=120)
    #: The snapshot already open on screen, which the picture freezes as it is.
    view_id: str | None = Field(default=None, max_length=64)


def _free_name(case, name: str, surface: str) -> str:
    """The name asked for, or the next free one beside it: a snapshot made to be cited is named for it."""
    taken = {
        str(view["name"]).strip().casefold()
        for view in case.list_analysis_views()
        if view_engine.family(view.get("surface")) == view_engine.family(surface)
    }
    base = name.strip()[:76]
    candidate, count = base, 1
    while candidate.casefold() in taken:
        count += 1
        candidate = f"{base} {count}"
    return candidate


@router.post("/figure")
def file_figure(case_id: str, body: FigureIn) -> dict[str, Any]:
    """File the Graph or the Timeline on screen as a picture, frozen by a snapshot.

    The plate (what the reading looks like, its lens, window and legend, drawn by the
    browser) is filed as an ordinary media file that names the snapshot it shows, so a
    note can cite it and open the exact reading. Without a snapshot open, one is made
    from the recipe and named for it. The same reading and size are one figure, which a
    second press cites rather than files again.
    """
    case = get_case(case_id)
    png = _clean_png(body.png)
    try:
        with Image.open(io.BytesIO(png)) as drawn:
            size = list(drawn.size)
    except Exception as exc:
        raise HTTPException(status_code=422, detail="the plate image is invalid") from exc
    frozen = None
    if body.view_id:
        frozen = case.get_analysis_view(body.view_id)
        if frozen is None:
            raise HTTPException(status_code=404, detail="that snapshot is no longer in the case")
        if frozen["mode"] != "snapshot" or frozen["surface"] != body.surface:
            raise HTTPException(status_code=409, detail="that reading is not a snapshot of this tool")
    # What decides the picture: the snapshot it freezes, or the recipe to be frozen, and its size.
    state_key = snapshots.view_key(
        FIGURE_SOURCE, surface=body.surface, size=size,
        **({"view": body.view_id} if body.view_id else {"spec": body.spec}),
    )
    if (filed := snapshots.filed_view(case, state_key)) is not None:
        attrs = filed.get("attrs") or {}
        return {"entity": filed["id"], "path": attrs.get("path"), "view": attrs.get(FIGURE_VIEW_ATTR), "reused": True}
    now = _now()
    made_here = frozen is None
    if frozen is None:
        name = _free_name(case, body.name, body.surface)
        frozen = _save(case, f"v_{uuid.uuid4().hex[:16]}",
                       AnalysisViewIn(name=name, mode="snapshot", surface=body.surface, spec=body.spec), created_at=now)
    source: dict[str, Any] = {
        "type": FIGURE_SOURCE, "surface": body.surface, "view": frozen["id"], "name": frozen["name"],
        "rendered_at": now, snapshots.VIEW_KEY: state_key,
    }
    attrs = {FIGURE_VIEW_ATTR: frozen["id"], FIGURE_SURFACE_ATTR: body.surface, snapshots.VIEW_KEY: state_key}
    try:
        made = media_engine.import_rendered_bytes(case, png, body.filename, ".png", source, by=FIGURE_SOURCE, extra_attrs=attrs)
    except (OSError, ValueError, CaseError) as exc:
        # a snapshot made only for this picture does not stay behind without it
        if made_here:
            case.remove_analysis_view(frozen["id"])
        raise HTTPException(status_code=409, detail=f"could not file the picture: {errors.explain(exc)}") from exc
    return {"entity": made["entity"]["id"], "path": made["item"]["path"], "view": frozen["id"], "reused": False}
