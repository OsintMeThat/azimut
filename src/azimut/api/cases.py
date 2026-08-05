"""REST API for case lifecycle, entities and links.

The note bodies and their PDF export live next door in `api/notes.py`.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any, cast

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, StrictInt

from .. import config, workspace
from ..engine import bundles as bundle_engine
from ..engine import doctor as doctor_engine
from ..engine import entities as entity_engine
from ..engine import links as link_engine
from ..engine import media as media_engine
from ..engine import reveal as reveal_engine
from ..engine import satellite as satellite_engine
from ..engine import trash as trash_engine
from ..repository import EntityStatus
from ..workspace import Case, CaseError

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
            "from_media_kinds": sorted(entry.from_media_kinds),
            "to_media_kinds": sorted(entry.to_media_kinds),
        }
        for entry in link_engine.RELATION_TYPES
    ]


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
            # ``entity.label`` is the primary value, but "Name" is not an honest
            # reading for an IP address, a phone number or a claim. The generated
            # form names that field from the type instead of duplicating it in attrs.
            "identity_label": entry.identity_label,
            "identity_placeholder": entry.identity_placeholder,
            # heads the field block where they read as one subject; empty means the
            # fields stand on their own labels
            "group": entry.group,
            "attrs": [
                {
                    "key": attr.key,
                    "label": attr.label,
                    "hint": attr.hint,
                    "kind": attr.kind,
                    "editable": attr.editable,
                    # Served so the form refuses exactly what the API refuses; a
                    # rung list is the shortcut UI, the bounds are the contract.
                    "rungs": [{"label": name, "value": v} for name, v in attr.rungs],
                    "minimum": attr.minimum,
                    "maximum": attr.maximum,
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
            if body.action == "import" and body.path:
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
) -> dict[str, Any]:
    """A bounded page of the entity catalog (Step 5, "Bounded loading").

    Stable cursor order, server-side filters (a comma-separated ``type`` set,
    ``status``, a label substring ``q``, and folder — ``unfiled=true`` or an
    ``folder`` path, optionally including descendants) and a ``next_cursor``
    that is null on the last page. ``limit`` is clamped so no request can ask
    for the whole graph at once.
    """
    case = get_case(case_id)
    limit = max(1, min(limit, 500))
    types = [t.strip() for t in type.split(",") if t.strip()] if type else None
    valid_status = (
        cast(EntityStatus, status) if status in ("confirmed", "suggested") else None
    )
    try:
        return case.page_entities(
            limit=limit, cursor=cursor, types=types, status=valid_status,
            query=q, folder=folder, unfiled=unfiled, recursive=recursive,
        )
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{case_id}/catalog/summary")
def catalog_summary(case_id: str) -> dict[str, Any]:
    """Total plus per-type and per-status counts, so the catalog can show badges
    without loading the graph."""
    return get_case(case_id).catalog_summary()


@router.get("/{case_id}/entities/lookup")
def lookup_entity(case_id: str, attr: str, value: str) -> dict[str, Any]:
    """One entity by an ``attrs`` value (``path``, ``spec``, ``draft``), or null.

    The bounded replacement for a tool scanning the whole graph to answer "is the
    file/spec I am bound to still in the case?" after a delete elsewhere, or to
    resolve a file path back to its entity (Step 5).
    """
    entity = get_case(case_id).find_entity(attr=attr, value=value)
    return {"entity": entity}


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
    """Confirm a suggestion, correct which relation an edge states, or rate it.

    Restating the type goes through the vocabulary, so a 400 means the ontology
    has no such reading for those two entities; a missing link is a 404.

    Rating runs last on purpose: confirming a suggestion and rating it can arrive in
    one request, and a rating is refused on an unreviewed edge — so the confirm has
    to have landed before the rating is judged.
    """
    rating = "confidence" in body.model_fields_set
    if body.status is None and body.type is None and not rating:
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
