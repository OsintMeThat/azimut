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
        attr: str | None = None,
        attr_value: str | None = None,
        linked: str | None = None,
        unlinked: bool = False,
        since: str | None = None,
        until: str | None = None,
        filed_by: list[str] | None = None,
        order: str = "",
    ) -> dict[str, Any]:
        """A bounded, filtered slice of the catalog (Step 5, "Bounded loading").

        Returns ``{"items": [...], "next_cursor": str | None, "total": int}`` in a
        stable order. ``cursor`` is an opaque token from a previous page;
        ``next_cursor`` is None on the last page. Filters (``types`` set,
        ``status``, a label/type/folder/notes ``query``, folder —
        ``unfiled`` or an exact ``folder`` path, optionally including
        descendants — one stored field holding one value (``attr``/``attr_value``),
        having a neighbour of a type (``linked``) or none at all (``unlinked``), and
        when and by what the row was filed (``since``/``until``/``filed_by``)) run in
        the backend so the caller never materialises the whole graph.

        ``order`` sorts the whole filtered set — an empty one is the insertion order
        the cursor has always paged. Whichever is asked for, the cursor keys on the
        sort plus the row's own seat, so a concurrent append or delete never shifts a
        page already returned.

        ``total`` counts the whole filtered set, so the narrowing terms answer a
        question rather than only shortening a list: *how many videos have
        coordinates* is that number, and the page is which ones.
        """
        ...

    def catalog_summary(self) -> dict[str, Any]:
        """Total plus per-type, per-status, per-folder and per-filer counts.

        Feeds the catalog's badges and its filter menus without shipping entities to
        the caller — ``{"total": int, "by_type": {type: n}, "by_status": {status: n},
        "by_folder": {path: n}, "by_source": {who: n}, "linked_to": {type: n},
        "unlinked": int}``.

        ``linked_to`` counts entities that **have a neighbour** of each type, which is
        not how many of that type the case holds: it is what the "linked to" filter
        asks, and pricing that menu with the other number is a count that looks like an
        answer and is not one.
        """
        ...

    def attr_facets(
        self, *, types: list[str] | None = None, limit: int = 50
    ) -> list[dict[str, Any]]:
        """Which stored fields these entities hold, and which values, as a menu.

        ``[{"key": str, "entities": n, "values": [{"value": str, "count": n}],
        "truncated": bool}]``, most carried field first. This is what lets a field be
        filtered on without a query language: both selects are populated from the case,
        so every term is chosen rather than typed. Bounded — a field with more than
        ``limit`` distinct values returns none of them and says it was cut, because a
        menu of five thousand paths is not a way to choose.
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

    # -- graph reads -------------------------------------------------------
    #
    # Drawing a case asks a different question from listing it: not "the next
    # page" but "which nodes matter, and what joins them". These four answer it
    # without ever reaching the whole graph — three take a bounded id set, the
    # fourth an explicit limit.

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
        link_types: list[str] | None = None,
        order: str = "degree",
    ) -> dict[str, Any]:
        """``{entities, degrees, total, truncated, unlinked}`` — the most
        significant entities first, bounded by ``limit``.

        The narrowing terms are the catalog's own, so a filter set in the board and
        the same filter drawn as a graph cannot mean two things.

        ``order`` decides which nodes survive a case too large to draw whole:
        ``degree`` keeps the hubs so the shape of the case stays legible,
        ``recent`` keeps the latest work. ``link_types`` scopes the degree to one
        lens, so a node isolated *in that lens* reads as isolated.

        ``exclude_types`` is what that lens does not draw at all: those entities leave
        the ranking, and the edges reaching them leave every degree counted here.

        ``total`` and ``unlinked`` both count every entity matching the filters,
        returned or not: a degree-0 entity is the first thing a cut discards, so
        counting it off the page would report none of it on a large case.
        """
        ...

    def entities_by_ids(self, ids: list[str]) -> list[dict[str, Any]]:
        """A known set of entities in one read. Ids that no longer exist are
        skipped rather than raising: an expansion races deletion elsewhere."""
        ...

    def labels_of_type(self, type_: str) -> list[tuple[str, str]]:
        """Every entity of one type as ``(id, label)``, for comparing identities.

        Labels only, off the type index: the caller is asking whether the case
        already holds one identifier's value (``entities.identity_key``), and that
        normalization is vocabulary, so it cannot be pushed into SQL without the
        rules living in two places.
        """
        ...

    def links_among(
        self, ids: list[str], *, types: list[str] | None = None
    ) -> list[dict[str, Any]]:
        """Edges with both ends inside the set — the closed set a view can draw
        without inventing the node at the far end."""
        ...

    def links_touching(
        self,
        ids: list[str],
        *,
        types: list[str] | None = None,
        exclude_types: list[str] | None = None,
        end_types: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        """Edges with either end inside the set — one hop of an expansion.

        ``exclude_types`` drops an edge whose far end this reading does not draw, so a
        walk never steps onto one. ``end_types`` is the opposite question and the
        collapse's probe: only the edges that *do* reach one of those types.
        """
        ...

    def degrees_of(
        self,
        ids: list[str],
        *,
        types: list[str] | None = None,
        exclude_types: list[str] | None = None,
    ) -> dict[str, int]:
        """``{entity_id: n}`` for exactly these ids, over one lens's verbs.

        Every id asked for is present, zero included: this answers "how much
        would expanding this bring in?", where absence would read as unknown
        rather than as none — which is why ``exclude_types`` applies here too: a
        connection to a node the lens leaves out is not one a click can bring in.
        """
        ...

    # -- the graph's own arrangement ----------------------------------------
    #
    # Where a node was dragged to. Presentation rather than a statement about the
    # case, which is why it is a table of its own and not a key in ``attrs``: an
    # entity keeps identity, links and provenance (ONTOLOGY §1), a drag rewrites
    # no entity row, and letting the layout take over again is one delete.
    #
    # Every one of these is scoped to a lens, because that is what an arrangement
    # belongs to: a lens draws its own nodes and edges and clusters differently, so
    # one shared arrangement would anchor every reading into the shape of whichever
    # one it was built in.

    def graph_pins(self, lens: str) -> dict[str, tuple[float, float]]:
        """``{entity_id: (x, y)}`` for the nodes placed by hand in this lens.

        Unbounded on purpose: a pin exists because somebody dragged something, so
        the count follows the hand, not the size of the case.
        """
        ...

    def pin_entities(self, lens: str, pins: dict[str, tuple[float, float]]) -> int:
        """Fix these nodes at these canvas coordinates in this lens; returns how
        many landed.

        One transaction for the batch — a group drag is one act. An id that no
        longer exists is skipped, since a drag can race a delete elsewhere.
        """
        ...

    def unpin_entities(self, lens: str, ids: list[str]) -> int:
        """Hand these nodes back to the computed layout in this lens; returns how
        many were pinned in it."""
        ...

    def clear_graph_pins(self, lens: str) -> int:
        """Drop this lens's arrangement; returns how many pins it held."""
        ...

    # -- saved analysis views --------------------------------------------

    def list_analysis_views(self) -> list[dict[str, Any]]:
        """Named Board and Graph readings, newest edit first."""
        ...

    def get_analysis_view(self, view_id: str) -> dict[str, Any] | None:
        ...

    def save_analysis_view(self, view: dict[str, Any]) -> dict[str, Any]:
        ...

    def remove_analysis_view(self, view_id: str) -> dict[str, Any] | None:
        ...

    def reinsert_analysis_views(self, views: list[dict[str, Any]]) -> int:
        """Restore recipes removed by one recoverable delete action."""
        ...

    def get_entity(self, entity_id: str) -> dict[str, Any] | None:
        ...

    def find_entity(self, *, attr: str, value: Any) -> dict[str, Any] | None:
        ...

    def list_folders(self) -> list[str]:
        ...

    # -- entity image galleries ------------------------------------------

    def entity_images(self, entity_id: str) -> list[dict[str, Any]]:
        """The entity's private photos and Media references in display order."""
        ...

    def entity_image_thumbs(self, entity_ids: list[str]) -> dict[str, str]:
        """``{entity_id: thumbnail}`` for primary images with a cached thumb."""
        ...

    def entity_images_touching(self, entity_ids: list[str]) -> list[dict[str, Any]]:
        """Gallery rows whose entity or optional media end is in ``entity_ids``.

        Used by Trash to restore presentation state together with either end.
        """
        ...

    def add_entity_images(self, entity_id: str, media_ids: list[str]) -> int:
        """Attach new media in order; the first image becomes primary when needed."""
        ...

    def add_entity_image_file(
        self,
        entity_id: str,
        image_id: str,
        path: str,
        thumbnail: str,
        title: str,
    ) -> None:
        """Register one private presentation photo already written to disk."""
        ...

    def set_primary_entity_image(self, entity_id: str, image_id: str) -> None:
        ...

    def remove_entity_image(self, entity_id: str, image_id: str) -> dict[str, Any]:
        """Detach one image, return its record and promote the next if needed."""
        ...

    def reinsert_entity_images(self, rows: list[dict[str, Any]]) -> dict[str, int]:
        """Restore rows whose target and optional Media endpoint still exist."""
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

    def media_thumbs(self, entity_ids: list[str]) -> dict[str, str]:
        """The cached thumbnail of each of these entities that has one.

        Keyed by entity rather than by path because the callers that draw an
        entity — the graph among them — hold ids, and an entity with no indexed
        media is simply absent rather than mapped to nothing.
        """
        ...

    def media_kinds(self, entity_ids: list[str]) -> dict[str, str]:
        """``{entity_id: kind}`` — image, video, audio or file — for the entities
        the media index knows.

        Keyed by entity like the thumbnails, because the surfaces that draw one hold
        ids. An entity the index has never seen is absent rather than guessed at.
        """
        ...

    def media_origins(self, entity_ids: list[str]) -> dict[str, dict[str, str]]:
        """``{entity_id: {"type": …, "op": …}}`` — how the bytes behind each of these
        entities came into the case.

        ``type`` is the route (``upload``, ``download``, ``inspect``, ``satellite``…)
        and ``op`` the act that produced it where the producer recorded one (a frame,
        a collage). Keyed by entity like the kinds and the thumbnails, because the
        surfaces that draw one hold ids. An entity the index has never seen, or one
        whose row records no route, is absent rather than guessed at.
        """
        ...

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
        """Filter, sort and page media without scanning sidecar files.

        ``gps`` keeps only the items whose own metadata states a position.
        ``collected_only`` drops what the case made out of its own material
        (``links.MADE_HERE``) and scopes the facet counts with it, so no chooser
        offers rows the switch is hiding. ``facets.made_here_count`` says how many
        that is, on either setting.
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

    # -- trash journal -----------------------------------------------------
    #
    # A delete keeps hard-deleting the graph rows and records the recipe to put
    # them back, one row per delete action. Nothing else in the app filters on a
    # "deleted" state, because nothing else has to know.

    def add_trash_group(
        self,
        group_id: str,
        *,
        label: str,
        type_: str,
        item_count: int,
        size_bytes: int,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        ...

    def list_trash(self) -> list[dict[str, Any]]:
        """Every group, newest first, without its payload."""
        ...

    def get_trash_group(self, group_id: str) -> dict[str, Any] | None:
        """One group with the payload needed to restore it, or None."""
        ...

    def remove_trash_group(self, group_id: str) -> None:
        ...

    def clear_trash(self) -> list[str]:
        """Drop every group, returning their ids."""
        ...

    def trash_summary(self) -> dict[str, int]:
        """``{"groups": n, "items": n, "size_bytes": n}`` in one query."""
        ...

    def reinsert(
        self, entities: list[dict[str, Any]], links: list[dict[str, Any]]
    ) -> dict[str, int]:
        """Re-insert deleted entities with their original ids, plus the links
        whose two endpoints still exist."""
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

    def count_jobs(self, *, kind: str | None = None) -> dict[str, int]:
        ...

    def recover_jobs(self) -> int:
        ...

    def prune_jobs(self, *, kind: str | None = None) -> int:
        ...

    def replace_path_references(self, old: str, new: str) -> None:
        """Replace one exact case-relative path in entity attrs and job records."""
        ...
