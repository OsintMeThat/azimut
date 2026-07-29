"""The case graph storage boundary.

`CaseRepository` is the interface every tool and route uses to read and mutate
a case's entities, links, folders, durable jobs and media browse index. The
active implementation stores that structured state in per-case SQLite; callers
do not reach into database tables or the legacy ``case.json`` graph shape.

`workspace.Case` owns the case folder and delegates graph operations to the
SQLite implementation. Legacy JSON cases migrate on open before using this
contract. Keep the Protocol limited to operations with real consumers.

File-backed content (media bytes, note bodies) is deliberately **not** here: it
stays on the case shell (`Case`), which owns the filesystem layout, lifecycle
and path resolution. The media index mirrors sidecar fields needed for bounded
browsing; it is not a second copy of the media bytes.
"""

from __future__ import annotations

from typing import Any, Literal, Protocol, runtime_checkable

#: Confidence on an entity or link: an analyst's `confirmed` vs a tool's
#: `suggested` (SPEC §4). Defined here so it is owned by the storage contract;
#: `workspace` re-exports it for backward compatibility.
EntityStatus = Literal["confirmed", "suggested"]

#: A durable job's lifecycle state (doc "Job states"). `queued` work is claimed
#: `running` by the single worker, then finishes `ready` or, past its retry
#: budget, `failed`; `cancelled` is an explicit stop.
JobState = Literal["queued", "running", "ready", "failed", "cancelled"]


@runtime_checkable
class CaseRepository(Protocol):
    """Structured-data contract for one SQLite-backed case."""

    # -- reads -------------------------------------------------------------

    def snapshot(self) -> dict[str, Any]:
        """The full case view — manifest plus graph — in one consistent read.

        The format-agnostic whole-case read for graph algorithms that need
        entities and links together. The case-open response uses the bounded
        overview instead.
        """
        ...

    def list_entities(self) -> list[dict[str, Any]]:
        ...

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
    ) -> dict[str, Any]:
        """A bounded, filtered slice of the catalog (Step 5, "Bounded loading").

        Returns ``{"items": [...], "next_cursor": str | None}`` in a stable
        insertion order. ``cursor`` is an opaque token from a previous page;
        ``next_cursor`` is None on the last page. Filters (``types`` set,
        ``status``, a label/type/folder/notes ``query``, and folder —
        ``unfiled`` or an exact ``folder`` path, optionally including
        descendants) run in the backend so
        the caller never materialises the whole graph. The cursor keys on
        insertion order so a concurrent append never shifts a page already
        returned.
        """
        ...

    def catalog_summary(self) -> dict[str, Any]:
        """Total plus per-type, per-status and per-folder counts, in the backend.

        Feeds the catalog's badges without shipping entities to the caller —
        ``{"total": int, "by_type": {type: n}, "by_status": {status: n},
        "by_folder": {path: n}}``.
        """
        ...

    def list_links(self) -> list[dict[str, Any]]:
        ...

    def get_link(self, link_id: str) -> dict[str, Any] | None:
        """One edge by id, or None. The single-row read behind editing a relation,
        so correcting one never walks the graph."""
        ...

    def links_of(self, entity_id: str) -> list[dict[str, Any]]:
        """Every link incident to ``entity_id`` (either endpoint), in stable
        order. The bounded neighbour read behind the derivation chain — reads only
        the edges touching one entity, not the whole graph.
        """
        ...

    def count_dependents(self, *, link_type: str, from_type: str) -> dict[str, int]:
        """``{to_id: n}`` — how many entities of ``from_type`` point at each
        target through ``link_type``, in one grouped query for the whole case.

        The bulk counterpart of ``links_of``: a listing that needs "how much
        work hangs off each of these rows?" would otherwise pay one query per
        row on a screen that must stay fast. Targets nothing points at are
        absent from the map rather than present with a zero.
        """
        ...

    def count_incident_links(self, *, exclude_types: list[str]) -> dict[str, int]:
        """``{entity_id: n}`` — links incident to each entity in either
        direction, skipping ``exclude_types``, in one grouped query.

        The bulk "does this row have relations?" read. Callers own the
        vocabulary: passing the chain types leaves exactly the relations, which
        is what the derivation chain excludes too. Entities with none are absent
        rather than present with a zero.
        """
        ...

    def get_entity(self, entity_id: str) -> dict[str, Any] | None:
        ...

    def find_entity(self, *, attr: str, value: Any) -> dict[str, Any] | None:
        ...

    def list_folders(self) -> list[str]:
        ...

    # -- media browse index ------------------------------------------------

    def upsert_media_item(self, item: dict[str, Any], *, entity_id: str | None = None) -> None:
        """Insert or refresh one sidecar-derived media browse row."""
        ...

    def remove_media_item(self, path: str) -> None:
        ...

    def list_media_items(self) -> list[dict[str, Any]]:
        ...

    def media_items_by_paths(self, paths: list[str]) -> list[dict[str, Any]]:
        ...

    def page_media_items(
        self,
        *,
        q: str | None = None,
        kind: str | None = None,
        category: str | None = None,
        folder: str | None = None,
        gps: bool = False,
        sort: str = "newest",
        direction: str | None = None,
        limit: int = 200,
        offset: int = 0,
    ) -> dict[str, Any]:
        """Filter, sort and page media without scanning sidecar files.

        ``gps`` keeps only the items whose own metadata states a position.
        """
        ...

    # -- entity mutations --------------------------------------------------

    def add_entity(
        self,
        type_: str,
        label: str,
        attrs: dict[str, Any] | None = None,
        *,
        by: str,
        status: EntityStatus = "confirmed",
        source: str | None = None,
    ) -> dict[str, Any]:
        ...

    def update_entity(self, entity_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        ...

    def remove_entity(self, entity_id: str) -> None:
        ...

    # -- link mutations ----------------------------------------------------

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
        ...

    def sync_links(
        self,
        from_id: str,
        type_: str,
        to_ids: list[str],
        *,
        by: str,
        status: EntityStatus = "confirmed",
    ) -> list[dict[str, Any]]:
        ...

    def update_link(self, link_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        """Set a link's ``status`` and/or ``type``, keeping its id and provenance."""
        ...

    def remove_link(self, link_id: str) -> None:
        ...

    # -- folders -----------------------------------------------------------

    def add_folder(self, name: str) -> list[str]:
        ...

    def remove_folder(self, name: str) -> list[str]:
        ...

    # -- durable jobs ------------------------------------------------------
    #
    # Local background work (thumbnails today; EXIF, OCR, transcripts later) that
    # must survive a restart. Keyed jobs are idempotent — a re-enqueue for the
    # same ``(kind, key)`` never stacks a duplicate — so the same call both
    # schedules and regenerates. The single worker claims one at a time.

    def enqueue_job(
        self,
        kind: str,
        *,
        key: str | None = None,
        payload: dict[str, Any] | None = None,
        max_attempts: int = 3,
    ) -> dict[str, Any]:
        ...

    def claim_job(self, *, kinds: list[str] | None = None) -> dict[str, Any] | None:
        ...

    def complete_job(self, job_id: str) -> None:
        ...

    def fail_job(self, job_id: str, error: str) -> dict[str, Any]:
        ...

    def cancel_job(self, job_id: str) -> None:
        ...

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        ...

    def list_jobs(
        self, *, kind: str | None = None, state: str | None = None
    ) -> list[dict[str, Any]]:
        ...

    def count_jobs(self) -> dict[str, int]:
        ...

    def recover_jobs(self) -> int:
        ...

    def prune_jobs(self, *, kind: str | None = None) -> int:
        ...
