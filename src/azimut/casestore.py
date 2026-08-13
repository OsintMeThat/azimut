"""The store contract `Case` presents, forwarded to the backend that holds it.

A case is a folder: a manifest, notes on disk, media files, a trash directory. Its
graph is none of those — it lives in `case.db` and is `sqlite_backend.SqliteCase`.
Both are one object to the rest of the app, because a route asks a case for its
entities without caring which half answers.

That seam is what this class is. Every method here forwards to the store and does
nothing else; anything that also touches the folder (creating a note, renaming an
artifact, promoting a scratch case) stays on `Case`, where the two halves have to be
kept in step. Splitting them apart is what keeps that distinction readable: what is
in this file is, by construction, not case-folder behaviour.

The methods are grouped as `repository.CaseRepository` groups them — catalog and
media reads, the timeline projection, graph pins and analysis views, entity and link
writes, folders, the trash journal, the durable job queue.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from .repository import EntityStatus

if TYPE_CHECKING:
    from .sqlite_backend import SqliteCase


class CaseStore:
    """Forwards the store half of the case contract. Mixed into `Case`."""

    def _graph(self) -> "SqliteCase":
        """The store behind this case. `Case` supplies it; see `Case._graph`."""
        raise NotImplementedError

    def list_entities(self) -> list[dict[str, Any]]:
        return self._graph().list_entities()

    def page_entities(
        self,
        *,
        limit: int = 100,
        cursor: str | None = None,
        types: list[str] | None = None,
        status: EntityStatus | None = None,
        query: str | None = None,
        folder: str | None = None,
        unfiled: bool = False,
        recursive: bool = False,
        attr: str | None = None,
        attr_value: str | None = None,
        linked: str | None = None,
        unlinked: bool = False,
        since: str | None = None,
        until: str | None = None,
        filed_by: list[str] | None = None,
        temporal_since: str | None = None,
        temporal_until: str | None = None,
        temporal_categories: list[str] | None = None,
        order: str = "",
    ) -> dict[str, Any]:
        """A bounded, filtered page of the catalog (Step 5), paged with an indexed
        keyset over the ordering asked for."""
        return self._graph().page_entities(
            limit=limit,
            cursor=cursor,
            types=types,
            status=status,
            query=query,
            folder=folder,
            unfiled=unfiled,
            recursive=recursive,
            attr=attr,
            attr_value=attr_value,
            linked=linked,
            unlinked=unlinked,
            since=since,
            until=until,
            filed_by=filed_by,
            temporal_since=temporal_since,
            temporal_until=temporal_until,
            temporal_categories=temporal_categories,
            order=order,
        )

    def catalog_summary(self) -> dict[str, Any]:
        """Total plus per-type, per-status, per-folder and per-filer counts."""
        return self._graph().catalog_summary()

    def attr_facets(
        self, *, types: list[str] | None = None, limit: int = 50
    ) -> list[dict[str, Any]]:
        """Which stored fields these entities hold, and which values, as a menu."""
        return self._graph().attr_facets(types=types, limit=limit)

    def list_links(self) -> list[dict[str, Any]]:
        return self._graph().list_links()

    def entity_images(self, entity_id: str) -> list[dict[str, Any]]:
        return self._graph().entity_images(entity_id)

    def entity_image_thumbs(self, entity_ids: list[str]) -> dict[str, str]:
        return self._graph().entity_image_thumbs(entity_ids)

    def entity_images_touching(self, entity_ids: list[str]) -> list[dict[str, Any]]:
        return self._graph().entity_images_touching(entity_ids)

    def add_entity_images(self, entity_id: str, media_ids: list[str]) -> int:
        return self._graph().add_entity_images(entity_id, media_ids)

    def add_entity_image_file(
        self,
        entity_id: str,
        image_id: str,
        path: str,
        thumbnail: str,
        title: str,
    ) -> None:
        self._graph().add_entity_image_file(
            entity_id, image_id, path, thumbnail, title
        )

    def set_primary_entity_image(self, entity_id: str, image_id: str) -> None:
        self._graph().set_primary_entity_image(entity_id, image_id)

    def remove_entity_image(self, entity_id: str, image_id: str) -> dict[str, Any]:
        return self._graph().remove_entity_image(entity_id, image_id)

    def reinsert_entity_images(self, rows: list[dict[str, Any]]) -> dict[str, int]:
        return self._graph().reinsert_entity_images(rows)

    def upsert_media_item(self, item: dict[str, Any], *, entity_id: str | None = None) -> None:
        self._graph().upsert_media_item(item, entity_id=entity_id)

    def remove_media_item(self, path: str) -> None:
        self._graph().remove_media_item(path)

    def timeline_page(
        self,
        *,
        since: str | None = None,
        until: str | None = None,
        categories: list[str] | None = None,
        entity_id: str | None = None,
        include_undated: bool = True,
        limit: int = 100,
        cursor: str | None = None,
        bucket: str | None = None,
        track: dict[str, Any] | None = None,
        spread: bool = False,
    ) -> dict[str, Any]:
        return self._graph().timeline_page(
            since=since,
            until=until,
            categories=categories,
            entity_id=entity_id,
            include_undated=include_undated,
            limit=limit,
            cursor=cursor,
            bucket=bucket,
            track=track,
            spread=spread,
        )

    def rebuild_temporal_projection(self) -> int:
        return self._graph().rebuild_temporal_projection()

    def temporal_projection_status(self) -> dict[str, int | bool]:
        return self._graph().temporal_projection_status()

    def list_media_items(self) -> list[dict[str, Any]]:
        return self._graph().list_media_items()

    def media_items_by_paths(self, paths: list[str]) -> list[dict[str, Any]]:
        return self._graph().media_items_by_paths(paths)

    def media_thumbs(self, entity_ids: list[str]) -> dict[str, str]:
        return self._graph().media_thumbs(entity_ids)

    def media_kinds(self, entity_ids: list[str]) -> dict[str, str]:
        return self._graph().media_kinds(entity_ids)

    def media_origins(self, entity_ids: list[str]) -> dict[str, dict[str, str]]:
        return self._graph().media_origins(entity_ids)

    def page_media_items(
        self,
        *,
        q: str | None = None,
        kind: str | None = None,
        category: str | None = None,
        folder: str | None = None,
        gps: bool = False,
        collected_only: bool = False,
        sort: str = "newest",
        direction: str | None = None,
        limit: int = 200,
        offset: int = 0,
    ) -> dict[str, Any]:
        return self._graph().page_media_items(
            q=q,
            kind=kind,
            category=category,
            folder=folder,
            gps=gps,
            collected_only=collected_only,
            sort=sort,
            direction=direction,
            limit=limit,
            offset=offset,
        )

    def get_link(self, link_id: str) -> dict[str, Any] | None:
        return self._graph().get_link(link_id)

    def links_of(self, entity_id: str) -> list[dict[str, Any]]:
        return self._graph().links_of(entity_id)

    def count_dependents(self, *, link_type: str, from_type: str) -> dict[str, int]:
        return self._graph().count_dependents(link_type=link_type, from_type=from_type)

    def count_incident_links(self, *, exclude_types: list[str]) -> dict[str, int]:
        return self._graph().count_incident_links(exclude_types=exclude_types)

    def rank_entities(
        self,
        *,
        limit: int = 200,
        types: list[str] | None = None,
        exclude_types: list[str] | None = None,
        status: EntityStatus | None = None,
        query: str | None = None,
        folder: str | None = None,
        unfiled: bool = False,
        recursive: bool = False,
        attr: str | None = None,
        attr_value: str | None = None,
        linked: str | None = None,
        unlinked_only: bool = False,
        since: str | None = None,
        until: str | None = None,
        filed_by: list[str] | None = None,
        temporal_since: str | None = None,
        temporal_until: str | None = None,
        temporal_categories: list[str] | None = None,
        link_types: list[str] | None = None,
        order: str = "degree",
    ) -> dict[str, Any]:
        return self._graph().rank_entities(
            limit=limit, types=types, exclude_types=exclude_types, status=status,
            query=query, folder=folder, unfiled=unfiled, recursive=recursive,
            attr=attr, attr_value=attr_value, linked=linked, unlinked_only=unlinked_only,
            since=since, until=until, filed_by=filed_by,
            temporal_since=temporal_since, temporal_until=temporal_until,
            temporal_categories=temporal_categories,
            link_types=link_types, order=order,
        )

    def entities_by_ids(self, ids: list[str]) -> list[dict[str, Any]]:
        return self._graph().entities_by_ids(ids)

    def labels_of_type(self, type_: str) -> list[tuple[str, str]]:
        return self._graph().labels_of_type(type_)

    def links_among(
        self, ids: list[str], *, types: list[str] | None = None
    ) -> list[dict[str, Any]]:
        return self._graph().links_among(ids, types=types)

    def links_touching(
        self,
        ids: list[str],
        *,
        types: list[str] | None = None,
        exclude_types: list[str] | None = None,
        end_types: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        return self._graph().links_touching(
            ids, types=types, exclude_types=exclude_types, end_types=end_types
        )

    def degrees_of(
        self,
        ids: list[str],
        *,
        types: list[str] | None = None,
        exclude_types: list[str] | None = None,
    ) -> dict[str, int]:
        return self._graph().degrees_of(ids, types=types, exclude_types=exclude_types)


    def graph_pins(self, lens: str) -> dict[str, tuple[float, float]]:
        return self._graph().graph_pins(lens)

    def pin_entities(self, lens: str, pins: dict[str, tuple[float, float]]) -> int:
        return self._graph().pin_entities(lens, pins)

    def unpin_entities(self, lens: str, ids: list[str]) -> int:
        return self._graph().unpin_entities(lens, ids)

    def clear_graph_pins(self, lens: str) -> int:
        return self._graph().clear_graph_pins(lens)

    def list_analysis_views(self) -> list[dict[str, Any]]:
        return self._graph().list_analysis_views()

    def get_analysis_view(self, view_id: str) -> dict[str, Any] | None:
        return self._graph().get_analysis_view(view_id)

    def save_analysis_view(self, view: dict[str, Any]) -> dict[str, Any]:
        return self._graph().save_analysis_view(view)

    def remove_analysis_view(self, view_id: str) -> dict[str, Any] | None:
        return self._graph().remove_analysis_view(view_id)

    def reinsert_analysis_views(self, views: list[dict[str, Any]]) -> int:
        return self._graph().reinsert_analysis_views(views)

    def get_entity(self, entity_id: str) -> dict[str, Any] | None:
        return self._graph().get_entity(entity_id)

    def note_ids_by_titles(self, titles: set[str]) -> dict[str, list[str]]:
        return self._graph().note_ids_by_titles(titles)

    def entity_count(self) -> int:
        """Entity total for the case switcher — one indexed count."""
        return self._graph().count_entities()

    def save_temporal_claim(
        self,
        *,
        entity_id: str | None,
        label: str,
        attrs: dict[str, Any],
        connectors: dict[str, list[str]] | None,
        by: str,
        status: EntityStatus = "confirmed",
    ) -> dict[str, Any]:
        return self._graph().save_temporal_claim(
            entity_id=entity_id,
            label=label,
            attrs=attrs,
            connectors=connectors,
            by=by,
            status=status,
        )

    def remove_entity(self, entity_id: str) -> None:
        self._graph().remove_entity(entity_id)

    def find_entity(self, *, attr: str, value: Any) -> dict[str, Any] | None:
        return self._graph().find_entity(attr=attr, value=value)

    def add_link(
        self,
        from_id: str,
        to_id: str,
        type_: str,
        *,
        by: str,
        status: EntityStatus = "confirmed",
        unique: bool = False,
    ) -> dict[str, Any]:
        """Add a typed edge. ``unique`` returns the existing identical edge
        instead of stacking a duplicate — what a producer wants when its output
        can dedupe onto an entity that is already in the case."""
        return self._graph().add_link(from_id, to_id, type_, by=by, status=status, unique=unique)

    def sync_links(
        self,
        from_id: str,
        type_: str,
        to_ids: list[str],
        *,
        by: str,
        status: EntityStatus = "confirmed",
    ) -> list[dict[str, Any]]:
        """Make ``from_id``'s outgoing links of ``type_`` exactly ``to_ids``.

        Re-saving an artifact restates its sources rather than piling onto them:
        edges that are still true are left untouched (same id, same timestamp),
        edges that are no longer true are dropped, new ones are appended. Unknown
        targets and a self-reference are ignored.
        """
        return self._graph().sync_links(from_id, type_, to_ids, by=by, status=status)

    def update_link(self, link_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        return self._graph().update_link(link_id, patch)

    def remove_link(self, link_id: str) -> None:
        self._graph().remove_link(link_id)

    def list_folders(self) -> list[str]:
        return self._graph().list_folders()

    def add_folder(self, name: str) -> list[str]:
        return self._graph().add_folder(name)

    def remove_folder(self, name: str) -> list[str]:
        return self._graph().remove_folder(name)

    # -- trash journal (engine/trash.py owns the files) ----------------------

    def add_trash_group(
        self,
        group_id: str,
        *,
        label: str,
        type_: str,
        item_count: int,
        size_bytes: int,
        payload: dict[str, Any],
        state: str = "ready",
    ) -> dict[str, Any]:
        return self._graph().add_trash_group(
            group_id,
            label=label,
            type_=type_,
            item_count=item_count,
            size_bytes=size_bytes,
            payload=payload,
            state=state,
        )

    def update_trash_group(
        self,
        group_id: str,
        *,
        state: str | None = None,
        size_bytes: int | None = None,
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return self._graph().update_trash_group(
            group_id,
            state=state,
            size_bytes=size_bytes,
            payload=payload,
        )

    def list_trash(self) -> list[dict[str, Any]]:
        return self._graph().list_trash()

    def get_trash_group(self, group_id: str) -> dict[str, Any] | None:
        return self._graph().get_trash_group(group_id)

    def list_incomplete_trash(self) -> list[dict[str, Any]]:
        return self._graph().list_incomplete_trash()

    def remove_trash_group(self, group_id: str) -> None:
        self._graph().remove_trash_group(group_id)

    def clear_trash(self) -> list[str]:
        return self._graph().clear_trash()

    def trash_summary(self) -> dict[str, int]:
        return self._graph().trash_summary()

    def reinsert(
        self, entities: list[dict[str, Any]], links: list[dict[str, Any]]
    ) -> dict[str, int]:
        return self._graph().reinsert(entities, links)

    # -- durable jobs (thumbnail and background-job model) -------------------

    def enqueue_job(
        self,
        kind: str,
        *,
        key: str | None = None,
        payload: dict[str, Any] | None = None,
        max_attempts: int = 3,
    ) -> dict[str, Any]:
        return self._graph().enqueue_job(kind, key=key, payload=payload, max_attempts=max_attempts)

    def claim_job(self, *, kinds: list[str] | None = None) -> dict[str, Any] | None:
        return self._graph().claim_job(kinds=kinds)

    def complete_job(self, job_id: str) -> None:
        self._graph().complete_job(job_id)

    def fail_job(self, job_id: str, error: str) -> dict[str, Any]:
        return self._graph().fail_job(job_id, error)

    def cancel_job(self, job_id: str) -> None:
        self._graph().cancel_job(job_id)

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        return self._graph().get_job(job_id)

    def list_jobs(
        self, *, kind: str | None = None, state: str | None = None
    ) -> list[dict[str, Any]]:
        return self._graph().list_jobs(kind=kind, state=state)

    def count_jobs(self, *, kind: str | None = None) -> dict[str, int]:
        return self._graph().count_jobs(kind=kind)

    def recover_jobs(self) -> int:
        return self._graph().recover_jobs()

    def prune_jobs(self, *, kind: str | None = None) -> int:
        return self._graph().prune_jobs(kind=kind)

    def replace_path_references(self, old: str, new: str) -> None:
        self._graph().replace_path_references(old, new)
