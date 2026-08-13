"""REST API for case lifecycle, entities and links.

The note bodies and their PDF export live next door in `api/notes.py`.
"""

from __future__ import annotations

import json
import math
import sqlite3
from io import BytesIO
from pathlib import Path
from typing import Any, Literal, cast

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, StrictInt

from .. import config, workspace
from ..engine import artifacts as artifact_engine
from ..engine import analysis_views as analysis_view_engine
from ..engine import bundles as bundle_engine
from ..engine import doctor as doctor_engine
from ..engine import entities as entity_engine
from ..engine import entity_images as entity_image_engine
from ..engine import graph as graph_engine
from ..engine import links as link_engine
from ..engine import media as media_engine
from ..engine import reveal as reveal_engine
from ..engine import satellite as satellite_engine
from ..engine import tally as tally_engine
from ..engine import trash as trash_engine
from ..engine import timeline as timeline_engine
from ..engine.temporal import TemporalError, window_bound
from ..repository import EntityStatus
from ..workspace import Case, CaseError
from .limits import MAX_IMAGE_BYTES

router = APIRouter(prefix="/api/cases", tags=["cases"])

#: Folders in the workspace that are not cases yet. Deliberately *not* under
#: `/api/cases`: a case's id is its folder name, so a literal segment there is a
#: name someone can give a folder — `/api/cases/folders` is already the case
#: named "Folders" (`tests/test_cases_api.py`). These operate on the workspace
#: anyway, one level above any case.
workspace_router = APIRouter(prefix="/api/workspace", tags=["cases"])


def get_case(case_id: str) -> Case:
    try:
        return Case.open(case_id)
    except CaseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def _ensure_name_free(name: str, *, exclude_id: str | None = None) -> None:
    """Reject a case name already taken by another (non-scratch) case, matched
    case-insensitively on the trimmed name. ``exclude_id`` lets a rename keep
    its own name."""
    wanted = name.strip().casefold()
    for c in Case.list_all():
        if c.get("scratch") or c["id"] == exclude_id:
            continue
        if str(c.get("name", "")).strip().casefold() == wanted:
            raise HTTPException(status_code=409, detail=f"a case named '{name}' already exists")


def delete_entities_deep(case: Case, entity_ids: list[str]) -> dict[str, Any]:
    """Delete one UI action and everything that cannot outlive its targets.

    The one door every delete goes through — sidebar, Media Library, a tool's
    own list — so the rules hold wherever the click came from:

    - artifacts that ``depends-on`` the target die with it (an Inspect session
      is only adjustments over a video), transitively;
    - artifacts ``derived-from`` it are never touched, and are scarred with a
      tombstone first, while the target can still describe itself.

    The whole action lands in the trash as one group, so undoing it brings the
    cascade back together or not at all. The graph rows are still hard-deleted:
    what is kept is the recipe, not a hidden state every other query would have
    to filter out.
    """
    with case.lock:
        going_by_id: dict[str, dict[str, Any]] = {}
        tombstoned: set[str] = set()
        for entity_id in dict.fromkeys(entity_ids):
            plan = link_engine.plan_delete(case, entity_id)
            target = case.get_entity(entity_id)
            if target is None:
                raise CaseError(f"entity '{entity_id}' not found")
            for entity in (target, *plan["cascade"]):
                going_by_id[entity["id"]] = entity
            tombstoned.update(entity["id"] for entity in plan["tombstone"])
        going = list(going_by_id.values())

        scars: list[dict[str, str]] = []
        losses = link_engine.losses(case, {e["id"] for e in going})
        for survivor_id, lost_sources in losses.items():
            survivor = case.get_entity(survivor_id)
            existing = {
                item.get("path")
                for item in (survivor or {}).get("attrs", {}).get(link_engine.LOST, [])
            }
            for lost in lost_sources:
                path = link_engine.tombstone_of(lost).get("path")
                if path and path not in existing:
                    scars.append({"entity": survivor_id, "path": path})
                    existing.add(path)

        group = trash_engine.send(case, going, scars)
        try:
            for survivor_id, lost_sources in losses.items():
                link_engine.add_tombstones(
                    case,
                    survivor_id,
                    [link_engine.tombstone_of(source) for source in lost_sources],
                )
            for entity in going:
                if case.get_entity(entity["id"]) is not None:
                    case.remove_entity(entity["id"])
            trash_engine.commit(case, group["id"])
        except Exception:
            trash_engine.rollback(case, group["id"])
            raise

        return {
            "status": "deleted",
            "deleted": [e["id"] for e in going],
            "tombstoned": sorted(tombstoned - set(going_by_id)),
            "trash": group["id"],
        }


def delete_entity_deep(case: Case, entity_id: str) -> dict[str, Any]:
    return delete_entities_deep(case, [entity_id])


def _summary(entity: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": entity["id"],
        "type": entity.get("type"),
        "label": entity.get("label"),
        "path": link_engine.artifact_path(entity),
    }


def delete_by_path(case: Case, rel_path: str) -> dict[str, Any]:
    """Chokepoint entry for a tool that knows its artifact by path, not by id.

    Returns an empty ``deleted`` when no entity claims the path: the artifact was
    never filed, so there is no graph to honour and the caller drops the files
    itself.
    """
    entity = (
        case.find_entity(attr="path", value=rel_path)
        or case.find_entity(attr="spec", value=rel_path)
        or case.find_entity(attr="draft", value=rel_path)
    )
    if entity is None:
        return {"status": "deleted", "deleted": [], "tombstoned": []}
    return delete_entity_deep(case, entity["id"])


class CreateCase(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class PromoteCase(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class EntityIn(BaseModel):
    type: str = Field(min_length=1, max_length=40)
    label: str = Field(min_length=1, max_length=300)
    attrs: dict[str, Any] = Field(default_factory=dict)
    status: EntityStatus = "confirmed"


class EntityPatch(BaseModel):
    type: str | None = None
    label: str | None = Field(default=None, min_length=1, max_length=300)
    attrs: dict[str, Any] | None = None
    status: EntityStatus | None = None


class EntityDeleteIn(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=200)


class EntityImagesIn(BaseModel):
    media_ids: list[str] = Field(min_length=1, max_length=100)


class LinkIn(BaseModel):
    # `from`/`to` are the link's own field names, but `from` is a Python keyword;
    # the request spells them out rather than aliasing around it.
    from_id: str = Field(min_length=1, max_length=64)
    to_id: str = Field(min_length=1, max_length=64)
    type: str = Field(min_length=1, max_length=40)


class LinkPatch(BaseModel):
    status: EntityStatus | None = None
    type: str | None = Field(default=None, min_length=1, max_length=40)
    #: One closed ordinal, or `null` to return the edge to "not assessed". Sending it
    #: at all is what counts, so the route reads `model_fields_set` rather than the
    #: value: `null` clears a rating, where omitting the key leaves it alone.
    #:
    #: Strict, so JSON `true` is refused rather than coerced to `1`: a lax int would
    #: turn a nonsense body into the "possible" level without anyone noticing, and
    #: `2.5` into `2`.
    confidence: StrictInt | None = None
    #: What kind of tie the edge states, in the analyst's own words, or `null` to
    #: clear it. Read through `model_fields_set` like the rating above, for the same
    #: reason: `null` unsays it, omitting the key leaves it alone. Only a verb
    #: declaring a `qualifier` accepts one (`engine/links.set_qualifier`).
    nature: str | None = None


class TemporalClaimIn(BaseModel):
    statement: str = Field(min_length=1, max_length=300)
    when: str | None = None
    time_role: Literal["occurred", "observed", "valid"] | None = None
    confidence: Literal["certain", "probable", "possible", "refuted"] | None = None
    method: str | None = None
    verbatim: str | None = None
    count: StrictInt | None = None
    condition: Literal["intact", "damaged", "destroyed", "abandoned"] | None = None
    about: list[str] = Field(default_factory=list, max_length=200)
    at: list[str] = Field(default_factory=list, max_length=50)
    cites: list[str] = Field(default_factory=list, max_length=200)


class TemporalClaimPatch(BaseModel):
    statement: str | None = Field(default=None, min_length=1, max_length=300)
    when: str | None = None
    time_role: Literal["occurred", "observed", "valid"] | None = None
    confidence: Literal["certain", "probable", "possible", "refuted"] | None = None
    method: str | None = None
    verbatim: str | None = None
    count: StrictInt | None = None
    condition: Literal["intact", "damaged", "destroyed", "abandoned"] | None = None
    about: list[str] | None = Field(default=None, max_length=200)
    at: list[str] | None = Field(default=None, max_length=50)
    cites: list[str] | None = Field(default=None, max_length=200)
    status: EntityStatus | None = None


class FolderIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class FolderName(BaseModel):
    """A directory name in the workspace root, never a path: what it may hold is
    `layout.usable_case_name`'s answer, checked where the folder is opened."""

    name: str = Field(min_length=1, max_length=120)


class BundlePassword(BaseModel):
    password: str | None = Field(default=None, max_length=1024)


class BundleUpload(BundlePassword):
    upload_id: str = Field(min_length=32, max_length=32)


class MediaPath(BaseModel):
    """One case-relative file path, bounded the way every other media route bounds
    one. Where it may point is `Case.resolve_inside`'s answer, not this model's."""

    path: str = Field(min_length=1, max_length=300)


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


class DoctorRepair(BaseModel):
    action: str = Field(min_length=1, max_length=20)
    entity_id: str | None = Field(default=None, max_length=64)
    path: str | None = Field(default=None, max_length=300)
    replacement: str | None = Field(default=None, max_length=300)


@router.get("")
def list_cases(q: str | None = None, limit: int | None = None) -> list[dict[str, Any]]:
    return Case.list_all(q=q, limit=limit)


@router.post("")
def create_case(body: CreateCase) -> dict[str, Any]:
    _ensure_name_free(body.name)
    try:
        case = Case.create(body.name)
    except CaseError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"id": case.id, **case.overview()}


@workspace_router.get("/folders")
def list_workspace_folders() -> list[dict[str, Any]]:
    """Folders sitting in the workspace that are not cases yet, and their state."""
    return workspace.list_workspace_folders()


@workspace_router.post("/folders/adopt")
def adopt_folder(body: FolderName) -> dict[str, Any]:
    """Make a case out of one of those folders, where it already is."""
    _ensure_name_free(body.name)
    try:
        case = Case.adopt(body.name)
    except CaseError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"id": case.id, **case.overview()}


@workspace_router.post("/folders/recover")
def recover_folder(body: FolderName) -> dict[str, Any]:
    """Write back the manifest of a folder holding a case that lost it.

    The manifest and nothing else: the case is reachable again after this, and
    anything still damaged belongs to the Doctor, which the caller opens next.
    """
    try:
        case = workspace.restore_manifest(body.name)
    except CaseError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"id": case.id, "name": case.read().get("name", case.id)}


@router.post("/scratch")
def create_scratch() -> dict[str, Any]:
    case = Case.create("Scratch session", scratch=True)
    return {"id": case.id, **case.overview()}


@router.post("/bundles/inspect")
def inspect_bundle(
    file: UploadFile = File(),
    password: str | None = Form(default=None, max_length=1024),
) -> dict[str, Any]:
    upload_id: str | None = None
    try:
        upload_id, path = bundle_engine.stage_upload(file.file)
        preview = bundle_engine.inspect_bundle(path, password=password)
    except CaseError as exc:
        if upload_id is not None:
            bundle_engine.discard_upload(upload_id)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    preview.pop("path", None)
    return {**preview, "upload_id": upload_id}


@router.post("/bundles/import")
def import_bundle(body: BundleUpload) -> dict[str, Any]:
    try:
        source = bundle_engine.uploaded_bundle(body.upload_id)
        case, job = bundle_engine.queue_import(
            source,
            password=body.password,
            cleanup_source=True,
        )
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "case_id": case.id,
        "name": case.read().get("name", case.id),
        "job_id": job["id"],
        "state": job["state"],
    }


@router.delete("/bundles/uploads/{upload_id}")
def discard_bundle_upload(upload_id: str) -> dict[str, str]:
    try:
        bundle_engine.discard_upload(upload_id)
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "discarded"}


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


@router.get("/{case_id}/doctor")
def doctor_report(case_id: str) -> dict[str, Any]:
    """Inspect a case even when its database is missing."""
    try:
        return doctor_engine.scan(Case.locate(case_id))
    except CaseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{case_id}/doctor/repair")
def doctor_repair(case_id: str, body: DoctorRepair) -> dict[str, Any]:
    """Apply one repair that the current Doctor report explicitly offers."""
    try:
        located = Case.locate(case_id)
        if body.action == "rebuild":
            result = doctor_engine.rebuild_database(located)
            case = located
        else:
            case = Case.open(case_id)
            if body.action == "rebuild-timeline":
                doctor_engine.require_stale_temporal_projection(case)
                result = {
                    "status": "rebuilt",
                    "items": case.rebuild_temporal_projection(),
                }
            elif body.action == "import" and body.path:
                doctor_engine.require_unknown_media(case, body.path)
                result = media_engine.register_existing(case, body.path)
            elif body.action == "drop" and body.entity_id:
                doctor_engine.require_missing_media(case, body.entity_id)
                result = delete_entity_deep(case, body.entity_id)
            elif body.action == "relink" and body.entity_id and body.replacement:
                doctor_engine.require_missing_media(case, body.entity_id)
                doctor_engine.require_unknown_media(case, body.replacement)
                result = media_engine.relink_existing(
                    case,
                    body.entity_id,
                    body.replacement,
                )
            else:
                raise CaseError("this repair action is not valid")
        return {"repair": result, "report": doctor_engine.scan(case)}
    except (CaseError, OSError, ValueError, sqlite3.Error) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/{case_id}")
def read_case(case_id: str) -> dict[str, Any]:
    case = get_case(case_id)
    return {"id": case.id, "scratch": case.is_scratch, **case.overview()}


@router.post("/{case_id}/promote")
def promote_case(case_id: str, body: PromoteCase) -> dict[str, Any]:
    case = get_case(case_id)
    _ensure_name_free(body.name)
    try:
        promoted = case.promote(body.name)
    except CaseError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"id": promoted.id, **promoted.overview()}


@router.patch("/{case_id}")
def rename_case(case_id: str, body: CreateCase) -> dict[str, Any]:
    case = get_case(case_id)
    _ensure_name_free(body.name, exclude_id=case.id)
    case.rename(body.name)
    return {"id": case.id, **case.overview()}


@router.delete("/{case_id}")
def delete_case(case_id: str) -> dict[str, str]:
    get_case(case_id).delete()
    return {"status": "deleted"}


@router.post("/{case_id}/reveal")
def reveal_case_folder(case_id: str) -> dict[str, str]:
    """Open this case's folder in the system file manager.

    The route takes no path: the case id is enough to find the folder, so nothing
    the browser sends can point somewhere else.
    """
    case = get_case(case_id)
    try:
        reveal_engine.reveal(case.path)
    except reveal_engine.RevealError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"path": str(case.path)}


@router.post("/{case_id}/media/reveal")
def reveal_media_folder(case_id: str, body: MediaPath) -> dict[str, str]:
    """Show the folder holding one of this case's files.

    For what the app cannot display: a PDF, a scan bundle, a spreadsheet. Handing
    those to the browser downloads a second copy into Downloads, which is how an
    analyst ends up working on a file the case no longer knows about. The folder is
    the honest answer — the original is opened in whatever program owns it.

    The path is the browser's, so it goes through ``resolve_inside`` like every
    other media route; ``reveal`` then re-checks that the folder is inside the
    workspace, and it is a folder that is opened, never the file itself.
    """
    case = get_case(case_id)
    try:
        target = case.resolve_inside(body.path)
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not target.is_file():
        raise HTTPException(status_code=404, detail="file not found")
    try:
        reveal_engine.reveal(target.parent)
    except reveal_engine.RevealError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"path": str(target.parent)}


@router.post("/{case_id}/bundle/export")
def export_bundle(case_id: str, body: BundlePassword) -> dict[str, Any]:
    case = get_case(case_id)
    try:
        job = bundle_engine.queue_export(case, password=body.password)
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "case_id": case.id,
        "job_id": job["id"],
        "state": job["state"],
    }


@router.get("/{case_id}/bundle/jobs/{job_id}")
def bundle_job(case_id: str, job_id: str) -> dict[str, Any]:
    job = bundle_engine.job_status(case_id, job_id)
    if job is None or job.get("kind") not in {
        bundle_engine.EXPORT_JOB,
        bundle_engine.IMPORT_JOB,
    }:
        raise HTTPException(status_code=404, detail=f"bundle job '{job_id}' not found")
    return {
        "id": job["id"],
        "kind": job["kind"],
        "state": job["state"],
        "error": job.get("error"),
    }


@router.get("/{case_id}/bundle/jobs/{job_id}/download")
def download_bundle(case_id: str, job_id: str) -> FileResponse:
    job = bundle_engine.job_status(case_id, job_id)
    if (
        job is None
        or job.get("kind") != bundle_engine.EXPORT_JOB
        or job.get("state") != "ready"
    ):
        raise HTTPException(status_code=404, detail="bundle download not ready")
    path = Path(job.get("payload", {}).get("output", ""))
    try:
        allowed = path.resolve().parent == config.bundles_dir().resolve()
    except OSError:
        allowed = False
    if not allowed or not path.is_file():
        raise HTTPException(status_code=404, detail="bundle download not found")
    return FileResponse(
        path,
        filename=path.name,
        media_type="application/octet-stream",
    )


def _explain_catalog_matches(page: dict[str, Any], query: str | None) -> dict[str, Any]:
    if not query:
        return page
    for entity in page.get("items", []):
        if matches := entity_engine.search_matches(entity, query):
            entity["matches"] = matches
    return page


def _temporal_filter_args(
    from_: str | None,
    to: str | None,
    category: str | None,
) -> tuple[str | None, str | None, list[str] | None]:
    """Validate the fact-time window kept separate from filing dates."""
    if from_ is None and to is None:
        return None, None, None
    if from_ is None or to is None:
        raise HTTPException(status_code=400, detail="a temporal filter needs both boundaries")
    since = _timeline_bound(from_, upper=False)
    until = _timeline_bound(to, upper=True)
    if since is not None and until is not None and since >= until:
        raise HTTPException(status_code=400, detail="the temporal filter ends before it starts")
    categories = (
        list(dict.fromkeys(part.strip() for part in category.split(",") if part.strip()))
        if category is not None
        else list(timeline_engine.DEFAULT_CATEGORIES)
    )
    invalid = sorted(set(categories) - set(timeline_engine.ALL_CATEGORIES))
    if invalid:
        raise HTTPException(status_code=400, detail=f"unknown timeline category '{invalid[0]}'")
    if not categories:
        raise HTTPException(status_code=400, detail="a temporal filter needs a category")
    return since, until, categories


@router.get("/{case_id}/catalog/entities")
def catalog_entities(
    case_id: str,
    cursor: str | None = None,
    limit: int = 100,
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
    order: str = "",
    view: str | None = None,
) -> dict[str, Any]:
    """A bounded page of the entity catalog (Step 5, "Bounded loading").

    Stable cursor order, server-side filters and a ``next_cursor`` that is null on the
    last page. ``limit`` is clamped so no request can ask for the whole graph at once.

    The filters: a comma-separated ``type`` set, ``status``, a label substring ``q``,
    folder (``unfiled=true`` or a ``folder`` path, optionally including descendants),
    one stored field holding one value (``attr`` with ``value``), having a neighbour of
    a type (``linked``) or none at all (``unlinked``), and how the row got here —
    ``since``/``until`` over the date it was filed, and a comma-separated ``by`` set of
    whatever filed it. Together they are what make the page an answer rather than a
    shorter list: *media, kind video, linked to a place* is "which videos have
    coordinates", and ``total`` is how many.

    ``order`` sorts the whole filtered set rather than the page — ``created`` and
    ``label``, each with a ``-`` prefix for the other direction. Empty is the insertion
    order that has always been the default.

    ``attr`` without ``value`` is not a term — it is the analyst having chosen which
    field they are about to ask about, and answering it as "holds nothing" would empty
    the table between two clicks of one act.
    """
    case = get_case(case_id)
    limit = max(1, min(limit, 500))
    if view:
        saved = case.get_analysis_view(view)
        if saved is None:
            raise HTTPException(status_code=404, detail=f"analysis view '{view}' not found")
        if saved["mode"] == "snapshot":
            try:
                return _explain_catalog_matches(
                    analysis_view_engine.snapshot_page(
                        saved, limit=limit, cursor=cursor, order=order
                    ),
                    q,
                )
            except CaseError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
    types = [t.strip() for t in type.split(",") if t.strip()] if type else None
    filed_by = [name.strip() for name in by.split(",") if name.strip()] if by else None
    temporal_since, temporal_until, temporal_categories = _temporal_filter_args(
        temporal_from, temporal_to, temporal_category
    )
    valid_status = (
        cast(EntityStatus, status) if status in ("confirmed", "suggested") else None
    )
    try:
        page = case.page_entities(
            limit=limit, cursor=cursor, types=types, status=valid_status,
            query=q, folder=folder, unfiled=unfiled, recursive=recursive,
            attr=attr, attr_value=value, linked=linked, unlinked=unlinked,
            since=since, until=until, filed_by=filed_by, order=order,
            temporal_since=temporal_since, temporal_until=temporal_until,
            temporal_categories=temporal_categories,
        )
        thumbs = case.entity_image_thumbs([entity["id"] for entity in page["items"]])
        for entity in page["items"]:
            if thumb := thumbs.get(entity["id"]):
                entity["thumb"] = thumb
        return _explain_catalog_matches(page, q)
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{case_id}/catalog/summary")
def catalog_summary(case_id: str) -> dict[str, Any]:
    """Counts per type, status, folder and filer, plus how many the case connects to
    nothing, so the catalog shows badges and populates its filter menus without
    loading the graph."""
    return get_case(case_id).catalog_summary()


@router.get("/{case_id}/catalog/attributes")
def catalog_attributes(case_id: str, type: str | None = None) -> dict[str, Any]:
    """Which stored fields these entities hold, and which values, as a menu.

    What lets a field be filtered on without a query language: the field select and
    the value select are both populated from the case, so every term of a search is
    chosen rather than typed (SPEC anti-goals). It reaches fields the vocabulary does
    not declare, which is the point — `kind` is written by the importer, so a
    registry-driven menu would never have offered the one field an analyst most wants.

    Narrowed by the same comma-separated ``type`` set as the page it filters: the
    fields a media holds are not the fields a claim holds, and one menu of both is a
    menu of neither.
    """
    types = [t.strip() for t in type.split(",") if t.strip()] if type else None
    return {"attrs": get_case(case_id).attr_facets(types=types)}


@router.get("/{case_id}/catalog/tally")
def catalog_tally(
    case_id: str,
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
) -> dict[str, Any]:
    """What the statements in this narrowing add up to, per subject.

    The same terms as the catalog page it sits beside, spelled the same way, because
    it is the same question: the table lists the statements, this one adds them up
    (``engine/tally.py``). Every rule about what may enter a sum is there — a ruled-out
    statement never does, an absent count is not one, and nothing is totalled across
    subjects.
    """
    types = [t.strip() for t in type.split(",") if t.strip()] if type else None
    filed_by = [name.strip() for name in by.split(",") if name.strip()] if by else None
    temporal_since, temporal_until, temporal_categories = _temporal_filter_args(
        temporal_from, temporal_to, temporal_category
    )
    try:
        return tally_engine.tally(
            get_case(case_id), types=types, status=status, query=q,
            folder=folder, unfiled=unfiled, recursive=recursive,
            attr=attr, attr_value=value, linked=linked, unlinked=unlinked,
            since=since, until=until, filed_by=filed_by,
            temporal_since=temporal_since, temporal_until=temporal_until,
            temporal_categories=temporal_categories,
        )
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


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


@router.get("/{case_id}/entities/lookup")
def lookup_entity(case_id: str, attr: str, value: str) -> dict[str, Any]:
    """One entity by an ``attrs`` value (``path``, ``spec``, ``draft``), or null.

    The bounded replacement for a tool scanning the whole graph to answer "is the
    file/spec I am bound to still in the case?" after a delete elsewhere, or to
    resolve a file path back to its entity (Step 5).
    """
    entity = get_case(case_id).find_entity(attr=attr, value=value)
    return {"entity": entity}


@router.get("/{case_id}/entities/twin")
def entity_twin(
    case_id: str, type: str, label: str, ignore: str = ""
) -> dict[str, Any]:
    """The entity already holding this identifier's value, or null.

    Only the ``identifier`` family answers anything: there the value *is* the
    identity, so two records of it are two records of one thing (ONTOLOGY §2).
    Everywhere else two entities may share a label and the question is meaningless.

    **It warns, it never refuses.** Merging is not shipped (`same-as`, SPEC §10), and
    a create that failed would leave the analyst holding a value with nowhere to put
    it — so this reports and the surface offers the row it found. ``ignore`` is the
    entity being renamed, which is not its own twin.

    The comparison lives in ``engine/entities.identity_key`` and is served rather
    than reimplemented: the create form used to lowercase the raw label in the
    browser, which let `@handle` and `handle` sit side by side as two accounts.
    """
    key = entity_engine.identity_key(type, label)
    if not key:
        return {"entity": None}
    case = get_case(case_id)
    for entity_id, existing in case.labels_of_type(type):
        if entity_id != ignore and entity_engine.identity_key(type, existing) == key:
            return {"entity": case.get_entity(entity_id)}
    return {"entity": None}


@router.post("/{case_id}/entities")
def add_entity(case_id: str, body: EntityIn) -> dict[str, Any]:
    case = get_case(case_id)
    _check_attrs(body.type, body.attrs)
    if body.type == "note":
        attrs = body.attrs
        return case.create_note(
            body.label.strip(),
            str(attrs.get("folder", "")).strip(),
            str(attrs.get("content", "")),
        )
    return case.add_entity(body.type, body.label, body.attrs, by="user", status=body.status)


def _check_attrs(
    type_: str,
    attrs: dict[str, Any],
    *,
    current: dict[str, Any] | None = None,
) -> None:
    """Refuse a malformed declared field with a 400, never a 404.

    Split out because the two write paths reach it from different places and the
    update path's own ``except CaseError`` answers 404 — a bad radius is a bad
    request, not a missing entity.
    """
    try:
        entity_engine.check_attrs(type_, attrs, current=current)
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _timeline_bound(raw: str | None, *, upper: bool) -> str | None:
    if raw is None:
        return None
    try:
        return window_bound(raw, upper=upper)
    except TemporalError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{case_id}/timeline")
def timeline(
    case_id: str,
    from_: str | None = Query(default=None, alias="from"),
    to: str | None = None,
    category: list[str] | None = Query(default=None),
    entity: str | None = None,
    include_undated: bool = True,
    limit: int = Query(default=100, ge=1, le=200),
    cursor: str | None = None,
    bucket: Literal["year", "month", "day", "hour"] | None = None,
    track: str | None = None,
    spread: bool = False,
) -> dict[str, Any]:
    """One bounded temporal page, independent of the projection's SQL shape.

    ``spread`` is for a caller drawing the page on an axis: it samples the window
    rather than serving its front, so a lopsided case fills the axis it spans.
    """
    since = _timeline_bound(from_, upper=False)
    until = _timeline_bound(to, upper=True)
    if since is not None and until is not None and since >= until:
        raise HTTPException(status_code=400, detail="the timeline window ends before it starts")
    if track and len(track.encode("utf-8")) > 64 * 1024:
        raise HTTPException(status_code=400, detail="timeline track query is too large")
    try:
        track_query = json.loads(track) if track else None
        if track_query is not None and not isinstance(track_query, dict):
            raise CaseError("a timeline track query must be an object")
        page = get_case(case_id).timeline_page(
            since=since,
            until=until,
            categories=category,
            entity_id=entity,
            include_undated=include_undated,
            limit=limit,
            cursor=cursor,
            bucket=bucket,
            track=track_query,
            spread=spread,
        )
    except (CaseError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {**page, "window": {"from": since, "to": until}}


# Every way the case puts something on the map. A Claim says where it happened with
# `at`, and that was the only one this layer knew — so a window full of photographs
# recorded somewhere, captures showing somewhere, or a structure standing somewhere
# answered with an empty map and the words "nothing carries a place". `mentions` is
# not here: a note referring to a place is not a thing that was there.
_MAP_PLACE_LINKS = (
    link_engine.AT,
    link_engine.LOCATED_AT,
    link_engine.DEPICTS,
    link_engine.SITED_AT,
)


@router.get("/{case_id}/timeline/map")
def timeline_map(
    case_id: str,
    from_: str = Query(alias="from"),
    to: str = Query(),
    category: list[str] | None = Query(default=None),
) -> dict[str, Any]:
    """Whatever the window holds that the case has put somewhere, for the Map layer."""
    since = _timeline_bound(from_, upper=False)
    until = _timeline_bound(to, upper=True)
    if since is None or until is None or since >= until:
        raise HTTPException(status_code=400, detail="the timeline window ends before it starts")
    categories = (
        list(dict.fromkeys(part.strip() for part in ",".join(category).split(",") if part.strip()))
        if category
        else list(timeline_engine.DEFAULT_CATEGORIES)
    )
    invalid = sorted(set(categories) - set(timeline_engine.ALL_CATEGORIES))
    if invalid:
        raise HTTPException(status_code=400, detail=f"unknown timeline category '{invalid[0]}'")
    if not categories:
        raise HTTPException(status_code=400, detail="a temporal filter needs a category")

    case = get_case(case_id)
    rows: list[dict[str, Any]] = []
    cursor: str | None = None
    read = 0
    total = 0
    ceiling = 5000
    while read < ceiling:
        page = case.timeline_page(
            since=since,
            until=until,
            categories=categories,
            include_undated=False,
            limit=min(200, ceiling - read),
            cursor=cursor,
        )
        if read == 0:
            total = int(page["total"])
        batch = list(page["items"])
        rows.extend(batch)
        read += len(batch)
        cursor = page["next_cursor"]
        if cursor is None or not batch:
            break

    # Resolved from the edges themselves rather than from the row's own `at` list,
    # which only a Claim ever fills.
    owners = {str(item["owner_id"]) for item in rows}
    held: dict[str, list[str]] = {}
    for edge in case.links_touching(
        sorted(owners), types=list(_MAP_PLACE_LINKS), end_types=["place"]
    ):
        if edge["from"] in owners and edge["to"] != edge["from"]:
            held.setdefault(edge["from"], []).append(edge["to"])

    place_ids = list(dict.fromkeys(
        place_id for places in held.values() for place_id in places
    ))
    places = {entity["id"]: entity for entity in case.entities_by_ids(place_ids)}

    # What a mark on the map has to know to hand its row back to the tool that owns
    # it, and to show a photograph as a photograph rather than as a line of text.
    placed_owners = sorted(held)
    owned = {entity["id"]: entity for entity in case.entities_by_ids(placed_owners)}
    thumbs = dict(case.media_thumbs(placed_owners))
    thumbs.update(case.entity_image_thumbs(placed_owners))
    for owner_id, entity in owned.items():
        # A capture or a proof records its own preview rather than owning an indexed
        # media row, and the graph reads them the same way.
        recorded = (entity.get("attrs") or {}).get("thumb")
        if recorded and owner_id not in thumbs:
            thumbs[owner_id] = recorded

    mapped: list[dict[str, Any]] = []
    mark_count = 0
    for item in rows:
        owner_id = str(item["owner_id"])
        owner = owned.get(owner_id)
        positioned = []
        for place_id in dict.fromkeys(held.get(owner_id, [])):
            place = places.get(place_id)
            attrs = place.get("attrs") if place else None
            if place is None or not isinstance(attrs, dict):
                continue
            try:
                lat = float(attrs["lat"])
                lon = float(attrs["lon"])
            except (KeyError, TypeError, ValueError):
                continue
            if not math.isfinite(lat) or not math.isfinite(lon):
                continue
            positioned.append({
                "id": place_id,
                "label": place.get("label", "Place"),
                "lat": lat,
                "lon": lon,
                "radius_m": attrs.get("radius_m"),
                "footprint": attrs.get("footprint"),
            })
        if positioned:
            mapped.append({
                **item,
                "place_entities": positioned,
                "owner": {
                    "id": owner_id,
                    "type": owner.get("type", "") if owner else item.get("owner_type", ""),
                    "label": owner.get("label", "") if owner else item.get("label", ""),
                    "attrs": owner.get("attrs") or {} if owner else {},
                    "thumb": thumbs.get(owner_id),
                },
            })
            mark_count += len(positioned)

    return {
        "items": mapped,
        "matched": total,
        "mapped": len(mapped),
        "marks": mark_count,
        "truncated": read < total,
        "window": {"from": since, "to": until},
    }


_TEMPORAL_CLAIM_ATTRS = (
    "when", "time_role", "confidence", "method", "verbatim", "count", "condition"
)
_TEMPORAL_CONNECTORS = ("about", "at", "cites")


def _temporal_item(case: Case, claim_id: str) -> dict[str, Any]:
    """The row this Claim owns, wherever the entity scope puts it.

    That scope also answers with rows owned by whatever cites the Claim, and they
    are ordered by date rather than by ownership — so a Claim many others rest on
    can sit past the first page, and reading only that page would fail a write
    that has already been committed.
    """
    cursor: str | None = None
    while True:
        page = case.timeline_page(
            categories=[timeline_engine.STATEMENT],
            entity_id=claim_id,
            include_undated=True,
            limit=200,
            cursor=cursor,
        )
        for item in page["items"]:
            if item["owner_id"] == claim_id:
                return item
        cursor = page["next_cursor"]
        if cursor is None:
            raise HTTPException(
                status_code=500,
                detail=f"claim '{claim_id}' was saved without a temporal row",
            )


def _check_claim_connectors(
    case: Case,
    source: dict[str, Any],
    connectors: dict[str, list[str]],
) -> None:
    for type_, targets in connectors.items():
        for target in dict.fromkeys(targets):
            target_entity = case.get_entity(target)
            if type_ == "about" and target_entity is not None and target_entity["type"] == "claim":
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "A Claim has one date or range. Edit its date, or create a"
                        " separate Claim."
                    ),
                )
            try:
                link_engine.check_relation_target(case, source, target, type_)
            except CaseError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{case_id}/timeline/claims")
def create_temporal_claim(case_id: str, body: TemporalClaimIn) -> dict[str, Any]:
    """Create the statement, date and all of its connectors in one transaction."""
    case = get_case(case_id)
    statement = body.statement.strip()
    if not statement:
        raise HTTPException(status_code=400, detail="a Claim statement cannot be empty")
    attrs = {
        key: getattr(body, key)
        for key in _TEMPORAL_CLAIM_ATTRS
        if getattr(body, key) is not None
    }
    _check_attrs("claim", attrs)
    connectors = {key: getattr(body, key) for key in _TEMPORAL_CONNECTORS}
    _check_claim_connectors(case, {"type": "claim"}, connectors)
    try:
        saved = case.save_temporal_claim(
            entity_id=None,
            label=statement,
            attrs=attrs,
            connectors=connectors,
            by="user",
        )
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {**saved, "temporal": _temporal_item(case, saved["entity"]["id"])}


@router.patch("/{case_id}/timeline/claims/{claim_id}")
def update_temporal_claim(
    case_id: str, claim_id: str, body: TemporalClaimPatch
) -> dict[str, Any]:
    """Replace a Claim's temporal fields and selected connector sets atomically."""
    if not body.model_fields_set:
        raise HTTPException(status_code=400, detail="nothing to update")
    case = get_case(case_id)
    current = case.get_entity(claim_id)
    if current is None:
        raise HTTPException(status_code=404, detail=f"entity '{claim_id}' not found")
    if current["type"] != "claim":
        raise HTTPException(status_code=400, detail=f"entity '{claim_id}' is not a Claim")
    if "statement" in body.model_fields_set and body.statement is None:
        raise HTTPException(status_code=400, detail="a Claim statement cannot be empty")
    statement = (body.statement or current["label"]).strip()
    if not statement:
        raise HTTPException(status_code=400, detail="a Claim statement cannot be empty")

    attrs = dict(current.get("attrs") or {})
    for key in _TEMPORAL_CLAIM_ATTRS:
        if key in body.model_fields_set:
            attrs[key] = getattr(body, key)
    _check_attrs("claim", attrs, current=current.get("attrs") or {})
    connector_keys = set(_TEMPORAL_CONNECTORS) & body.model_fields_set
    connectors = (
        {key: list(getattr(body, key) or []) for key in connector_keys}
        if connector_keys
        else None
    )
    if connectors is not None:
        _check_claim_connectors(case, current, connectors)
    try:
        saved = case.save_temporal_claim(
            entity_id=claim_id,
            label=statement,
            attrs=attrs,
            connectors=connectors,
            by="user",
            status=body.status or current["provenance"]["status"],
        )
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {**saved, "temporal": _temporal_item(case, claim_id)}


@router.delete("/{case_id}/timeline/claims/{claim_id}")
def remove_temporal_claim(case_id: str, claim_id: str) -> dict[str, Any]:
    """Delete one Claim through the normal recoverable Trash workflow."""
    case = get_case(case_id)
    entity = case.get_entity(claim_id)
    if entity is None:
        raise HTTPException(status_code=404, detail=f"entity '{claim_id}' not found")
    if entity["type"] != "claim":
        raise HTTPException(status_code=400, detail=f"entity '{claim_id}' is not a Claim")
    try:
        return delete_entity_deep(case, claim_id)
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/{case_id}/entities/{entity_id}")
def update_entity(case_id: str, entity_id: str, body: EntityPatch) -> dict[str, Any]:
    case = get_case(case_id)
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    if body.attrs is not None:
        # Against the type it will have once patched, and the entity has to exist
        # before its fields can be judged.
        current = case.get_entity(entity_id)
        if current is None:
            raise HTTPException(status_code=404, detail=f"entity '{entity_id}' not found")
        _check_attrs(
            body.type or str(current["type"]),
            body.attrs,
            current=current.get("attrs") or {},
        )
    try:
        entity = case.update_entity(entity_id, patch)
        if body.status == "confirmed":
            link_engine.confirm_incident_relations(case, entity_id)
        return entity
    except CaseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{case_id}/links")
def create_link(case_id: str, body: LinkIn) -> dict[str, Any]:
    """State one relation by hand. Confirmed, and only from the registry."""
    try:
        return link_engine.add_relation(
            get_case(case_id), body.from_id, body.to_id, body.type, by="user"
        )
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/{case_id}/links/{link_id}")
def update_link(case_id: str, link_id: str, body: LinkPatch) -> dict[str, Any]:
    """Confirm a suggestion, correct which relation an edge states, rate it, or say
    what kind of tie it is.

    Restating the type goes through the vocabulary, so a 400 means the ontology
    has no such reading for those two entities; a missing link is a 404.

    Rating runs last on purpose: confirming a suggestion and rating it can arrive in
    one request, and a rating is refused on an unreviewed edge — so the confirm has
    to have landed before the rating is judged. The qualifier runs last for the
    mirror reason: a reword that drops it must not be undone by a value sent against
    the verb the edge no longer states.
    """
    rating = "confidence" in body.model_fields_set
    qualifying = "nature" in body.model_fields_set
    if body.status is None and body.type is None and not rating and not qualifying:
        raise HTTPException(status_code=400, detail="nothing to update")
    case = get_case(case_id)
    try:
        link = case.get_link(link_id)
        if link is None:
            raise HTTPException(status_code=404, detail=f"link '{link_id}' not found")
        if body.type is not None and body.type != link["type"]:
            link = link_engine.set_relation_type(case, link_id, body.type)
        if body.status == "confirmed":
            link = link_engine.confirm_relation(case, link_id)
        elif body.status is not None:
            link = case.update_link(link_id, {"status": body.status})
        if rating:
            link = link_engine.set_confidence(case, link_id, body.confidence)
        if qualifying:
            link = link_engine.set_qualifier(case, link_id, body.nature)
        return link
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/{case_id}/links/{link_id}")
def remove_link(case_id: str, link_id: str) -> dict[str, str]:
    """Take back one relation. Dismissing a proposal and retracting a confirmed
    statement are the same gesture; a derivation is neither, and is refused with a
    400 rather than dropped without its tombstone."""
    case = get_case(case_id)
    if case.get_link(link_id) is None:
        raise HTTPException(status_code=404, detail=f"link '{link_id}' not found")
    try:
        link_engine.remove_relation(case, link_id)
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "deleted"}


@router.get("/{case_id}/entities/{entity_id}/dependents")
def entity_dependents(case_id: str, entity_id: str) -> dict[str, Any]:
    """What deleting this entity would take with it, and what it would scar.

    Feeds the confirm dialog so a delete states its consequences before it is
    irreversible (ONTOLOGY §3).
    """
    case = get_case(case_id)
    try:
        plan = link_engine.plan_delete(case, entity_id)
    except CaseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {
        "cascade": [_summary(e) for e in plan["cascade"]],
        "tombstone": [_summary(e) for e in plan["tombstone"]],
    }


@router.get("/{case_id}/entities/{entity_id}/chain")
def entity_chain(case_id: str, entity_id: str) -> dict[str, Any]:
    """One entity plus its derivation chain and direct relations, read from its
    incident links only without shipping the whole graph."""
    case = get_case(case_id)
    chain = link_engine.chain_of(case, entity_id)
    if chain is None:
        raise HTTPException(status_code=404, detail=f"entity '{entity_id}' not found")
    return chain


def _entity_image_error(exc: CaseError) -> HTTPException:
    status = 404 if "not found" in str(exc) else 400
    return HTTPException(status_code=status, detail=str(exc))


@router.get("/{case_id}/entities/{entity_id}/images")
def entity_images(case_id: str, entity_id: str) -> dict[str, Any]:
    """Presentation photos attached to one hand-made entity."""
    try:
        images = entity_image_engine.list_images(get_case(case_id), entity_id)
    except CaseError as exc:
        raise _entity_image_error(exc) from exc
    return {"images": images}


@router.post("/{case_id}/entities/{entity_id}/images")
def attach_entity_images(
    case_id: str, entity_id: str, body: EntityImagesIn
) -> dict[str, Any]:
    """Attach existing case images without creating semantic graph links."""
    try:
        return entity_image_engine.attach(get_case(case_id), entity_id, body.media_ids)
    except CaseError as exc:
        raise _entity_image_error(exc) from exc


@router.post("/{case_id}/entities/{entity_id}/images/upload")
async def upload_entity_image(
    case_id: str,
    entity_id: str,
    file: UploadFile = File(...),
) -> dict[str, Any]:
    """Store one private presentation photo outside the Media Library.

    Bounded at the edge like the two other surfaces that swallow an image, and
    against the same limit: a portrait is a portrait wherever it came from. The
    pixel clamp further in answers a decompression bomb, not a file that is simply
    enormous, and refusing early is what keeps a mistaken drag from filling the
    disk with a temporary nobody asked for.
    """
    raw = await file.read(MAX_IMAGE_BYTES + 1)
    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"photo must be under {MAX_IMAGE_BYTES // 1024 // 1024} MB",
        )
    try:
        return entity_image_engine.import_photo(
            get_case(case_id), entity_id, BytesIO(raw), file.filename
        )
    except CaseError as exc:
        raise _entity_image_error(exc) from exc


@router.put("/{case_id}/entities/{entity_id}/images/{image_id}/primary")
def set_primary_entity_image(
    case_id: str, entity_id: str, image_id: str
) -> dict[str, Any]:
    try:
        images = entity_image_engine.set_primary(get_case(case_id), entity_id, image_id)
    except CaseError as exc:
        raise _entity_image_error(exc) from exc
    return {"images": images}


@router.delete("/{case_id}/entities/{entity_id}/images/{image_id}")
def detach_entity_image(case_id: str, entity_id: str, image_id: str) -> dict[str, Any]:
    """Detach a Media reference or delete a private presentation photo."""
    try:
        images = entity_image_engine.detach(get_case(case_id), entity_id, image_id)
    except CaseError as exc:
        raise _entity_image_error(exc) from exc
    return {"images": images}


@router.get("/{case_id}/entities/{entity_id}/placement")
def entity_placement(case_id: str, entity_id: str) -> dict[str, Any]:
    """Where the derivation chain puts this entity, nearest placement first.

    Its own route rather than a field on the chain payload: the chain is read on
    every Details open and every map popup, and this walks further than one hop.
    """
    case = get_case(case_id)
    placement = satellite_engine.placements(case, entity_id)
    if placement is None:
        raise HTTPException(status_code=404, detail=f"entity '{entity_id}' not found")
    return placement


@router.get("/{case_id}/entities/{entity_id}/tally")
def entity_tally(case_id: str, entity_id: str) -> dict[str, Any]:
    """What the statements about this entity come to, or 404 when nothing states one.

    Its own route for the same reason placement is: the panel already lists the claims
    pointing here, and adding them up walks their attributes, which the chain read has
    no reason to carry on every Details open.

    Over the whole case, never a filter: the panel is not narrowed, so a total obeying
    a narrowing set on another screen would be a different number under one wording.
    """
    row = tally_engine.for_subject(get_case(case_id), entity_id)
    if row is None:
        raise HTTPException(status_code=404, detail="no statement is about this entity")
    return row


@router.get("/{case_id}/entities/{entity_id}/derivation")
def entity_derivation(case_id: str, entity_id: str) -> dict[str, Any]:
    """The transitive ``derived-from`` closure rooted at this entity as
    ``{entities, links}`` — the Post composer traces a proof back to its original
    downloaded media over this slice, not the whole graph (Step 5)."""
    case = get_case(case_id)
    subgraph = link_engine.derivation_subgraph(case, entity_id)
    if subgraph is None:
        raise HTTPException(status_code=404, detail=f"entity '{entity_id}' not found")
    return subgraph


@router.delete("/{case_id}/entities/{entity_id}")
def remove_entity(case_id: str, entity_id: str) -> dict[str, Any]:
    """Delete an entity and the on-disk artifact it stands for, so removing a
    row in the sidebar deletes it everywhere it appears (spec §3.5)."""
    case = get_case(case_id)
    try:
        return delete_entity_deep(case, entity_id)
    except CaseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{case_id}/entities/delete")
def remove_entities(case_id: str, body: EntityDeleteIn) -> dict[str, Any]:
    """Delete a multi-selection as one recoverable trash group."""
    case = get_case(case_id)
    try:
        return delete_entities_deep(case, body.ids)
    except CaseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/{case_id}/trash")
def list_trash(case_id: str) -> dict[str, Any]:
    """What the case is holding for you, newest first.

    Head columns only — no payload is read here, so the node costs one indexed
    query however much is waiting in it.
    """
    case = get_case(case_id)
    summary = case.trash_summary()
    return {
        "groups": case.list_trash(),
        "items": summary["items"],
        "size_bytes": summary["size_bytes"],
    }


@router.post("/{case_id}/trash/{group_id}/restore")
def restore_trash(case_id: str, group_id: str) -> dict[str, Any]:
    """Take one delete back, all of it or none.

    A 409 means a file is back at a path the group wants: restoring would have to
    rename an artifact behind the analyst, so it refuses and names the path
    instead.
    """
    case = get_case(case_id)
    try:
        return trash_engine.restore(case, group_id)
    except CaseError as exc:
        message = str(exc)
        status = 404 if "not found" in message else 409
        raise HTTPException(status_code=status, detail=message) from exc


@router.delete("/{case_id}/trash/{group_id}")
def purge_trash(case_id: str, group_id: str) -> dict[str, str]:
    """Drop one group for good. This is where the bytes actually go."""
    case = get_case(case_id)
    try:
        trash_engine.purge(case, group_id)
    except CaseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"status": "purged"}


@router.delete("/{case_id}/trash")
def empty_trash(case_id: str) -> dict[str, int]:
    return {"purged": trash_engine.empty(get_case(case_id))}


@router.get("/{case_id}/folders")
def list_folders(case_id: str) -> list[str]:
    return get_case(case_id).list_folders()


@router.post("/{case_id}/folders")
def add_folder(case_id: str, body: FolderIn) -> list[str]:
    case = get_case(case_id)
    try:
        return case.add_folder(body.name)
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/{case_id}/folders")
def remove_folder(case_id: str, name: str) -> list[str]:
    return get_case(case_id).remove_folder(name)
