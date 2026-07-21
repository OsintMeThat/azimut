# Case storage and performance

This document describes current case storage and the controls that keep large
cases responsive. The migration from a monolithic `case.json` graph to per-case
SQLite is complete.

Structured case data lives in SQLite. Images, videos, proof PNGs, drafts, saved
Inspect sessions and note bodies remain ordinary files inside the case folder.

## The shape of a case

```text
case.json       # small manifest: name, dates, storage format and schema
case.db         # entities, links, folders, catalog and jobs (SQLite)
notes.md        # case-wide Markdown note
notes/          # filed Markdown note bodies (one file per note entity)
media/          # imported, downloaded and derived media + sidecars
  .dl/          #   in-progress downloads (transient)
  .thumbs/      #   disposable thumbnail cache
proofs/         # editable proof specs and rendered PNGs
exports/        # post drafts and reports
inspect/        # saved Inspect session specs
search/         # saved Grid Search state
```

`case.json` is the discovery manifest: name, creation date, and the storage and
schema fields. It no longer holds the graph, so the case switcher can identify a
case without opening its database. `case.db` is the source of truth for mutable
structured state (entities, links, folders, jobs). The files under `media/`,
`proofs/`, `exports/`, `inspect/` and `notes/` are the source of truth for their
own content.

Every mutation used to re-read and rewrite the whole `case.json` under a per-case
lock. At 10k entities that rewrote megabytes per edit and shipped the entire
graph to the browser on open. SQLite removes both ceilings: a single edit touches
one row in one short transaction, and case open ships a manifest instead of a
graph.

## Source of truth

`case.db` owns the graph. Portability currently means copying the complete case
folder while it is closed; rollback journaling leaves no WAL checkpoint outside
that folder. Media, proofs and note bodies remain inspectable files. A future
case ZIP workflow will package and import this same folder without creating a
second writable copy.

## Ownership rules

Each value has one owner. Cached copies may exist, but they are disposable and
carry enough information to detect staleness.

| Data | Owner | Notes |
|---|---|---|
| Case name and storage version | `case.json` | Small manifest, atomically replaced |
| Entities, links and folders | `case.db` | Transactional and versioned |
| Mutable titles and notes | `case.db` | Never duplicated into a writable sidecar |
| Image, video and audio bytes | Filesystem | Never stored as database blobs |
| Proof and session content | Their JSON/PNG files | Registered as artifacts in the database |
| Acquisition provenance | Media sidecar | Immutable after registration |
| Background jobs | `case.db` (`jobs`) | Durable, recoverable, one worker |
| Thumbnails | `media/.thumbs/` | Cache; safe to remove at any time |
| Note bodies | `notes.md`, `notes/<id>.md` | Graph keeps only id, title, folder, path |

## Packaging and frozen-binary constraints

The same storage layer serves `pip install azimut` and PyInstaller binaries for
Windows, macOS and Linux:

- **No runtime dependency was added.** SQLite is the stdlib `sqlite3` module,
  already bundled by PyInstaller; the durable queue and thumbnail worker use only
  `threading`/`subprocess`/`sqlite3` plus the already-declared Pillow. The three
  binaries build unchanged. `tests/test_release_gate.py` guards this.
- **Feature availability is per-binary, not per-Python.** `sqlite3` links whatever
  SQLite the build environment provides, so FTS5, JSON1 and RTree can be present
  on the dev machine yet missing from a shipped binary. The store stays on core
  SQL: `find_entity` scans and matches attributes in Python rather than relying on
  JSON1. Any future indexed projection (geo, time, full-text) is probed at runtime
  with a `LIKE`/scan fallback before it enters the contract.
- **`case.db` lives under the workspace root**, inside the case folder, never
  beside the frozen executable, which may sit on read-only media.
- **Dev-only tooling stays out of the artifact.** The synthetic fixture
  (`tests/bigcase.py`) and the benchmark harness (`bench/case_baseline.py`) live
  outside `src/azimut/`, so hatchling never packages them, and use only the
  standard library.

## The storage boundary

`repository.py` defines `CaseRepository`, the one interface every tool and route
uses to read and mutate a case's graph, catalog and jobs. Nothing outside the
implementation reaches into a raw `case.json` shape. `workspace.Case` is the
filesystem shell (manifest, notes, media, lifecycle, path resolution) and
delegates every graph, catalog and job method to a `SqliteCase`
(`sqlite_backend.py`) over `case.db`. `engine/links.py` and `api/cases.py` read
through `get_entity` / `links_of` / `snapshot`, never the file.

`snapshot()` returns the whole graph for delete planning, export, migration checks
and test assertions.
`overview()` is the case-open view: the manifest and folder list, without the
entity/link arrays. Direct storage access outside `Case`/`SqliteCase` should fail
review.

## Database shape

`case.db` is at SQLite schema 3. The schema counter is independent of the JSON
`CASE_SCHEMA`: the manifest's `azimut.storage` field selects the backend, and each
format counts its own shape upgrades.

### Tables

`meta`
: Schema version, case name and timestamps.

`schema_migrations`
: Every applied SQLite-schema migration and its completion time.

`entities`
: `id`, `type`, `label`, `attrs_json`, an indexed `folder` (denormalised from
  `attrs.folder`), provenance fields and status. Unknown types and attributes stay
  valid.

`links`
: `id`, source, target, `type`, provenance and status. Foreign keys forbid a link
  to a missing entity. The delete policy lives in the dependency-aware service
  (`engine/links.py`), not in a blind SQL cascade.

`folders`
: Normalized `/`-separated logical paths for the analyst's organisation. Not
  filesystem directories, not semantic links.

`jobs`
: Durable local background work: `id`, `kind`, an optional `job_key`, `state`,
  `attempts`, `max_attempts`, `payload_json`, `error` and timestamps. See
  "Thumbnails and background jobs".

### Indexes and migrations

Indexes cover entity type/status/folder and link source/target/type, plus job
state and a partial unique index on `(kind, job_key)` that keeps a keyed job from
being enqueued twice. `SqliteCase.open` upgrades an older `case.db` in place
through `_SQLITE_MIGRATIONS`, each step in its own immediate transaction, re-reading
the version inside the transaction so a raced second opener applies nothing; a
newer schema is refused rather than mangled. The two shipped migrations add the
indexed `folder` column (1→2) and the `jobs` table (2→3).

Geographic, temporal and full-text projections are deferred until a query needs
them. Each projection requires its own migration and tests.

### Connection policy

- Foreign keys on every connection; a bounded `busy_timeout` instead of failing a
  short write immediately.
- Transactions are short. File hashing and ffmpeg work happen outside them.
- Rollback journal with `synchronous=FULL` (not WAL): the app is single-user and
  portability matters more than write concurrency, so a plain folder copy of a
  closed case is always complete with nothing to checkpoint.
- A fresh connection per operation, closed before any rename, so Windows' rules
  for open files and directory replacement are respected. Writes run in one
  `BEGIN IMMEDIATE`..`COMMIT` and roll back on error.

## Automatic migration of legacy cases

Legacy json cases still open. `Case.open` runs `migrate`: it applies the json-shape
migrations up to `JSON_SCHEMA`, materializes any inline note bodies to files, then
`convert_json_to_sqlite` builds `case.db` and the manifest is flipped to
`{"schema": 3, "storage": "sqlite"}` **last**. A crash before the flip leaves the
legacy json case active. A `case.pre-migrate-v<n>.json` backup is taken once before
the first rewrite and never overwritten, so the conversion is recoverable.

The converter builds `case.db.tmp`, imports the whole graph in one transaction,
runs `foreign_key_check` and `integrity_check`, then atomically renames into place;
any failure removes the temp file and leaves the target untouched. A link to a
missing endpoint is reported (`MigrationReport.missing_endpoints`) and dropped,
never erasing an entity. Recorded media hashes are imported as-is; migration does
not rehash large videos; an integrity scan is a separate, explicit action.

The live in-file JSON graph backend has been removed. `Case.create` always makes a
`case.db`; no code path writes an entity/link graph back into `case.json`. The only
JSON code left is the one-way importer and the on-open migration.

## Bounded catalog API

SQLite only helps the interface when queries and rendering are bounded. Case open
ships `overview()` (manifest + folders), and the catalog loads through cursor-paged
endpoints:

- `GET /api/cases/{id}/catalog/entities` returns `{items, next_cursor}` in stable
  insertion order, with a clamped page size and server-side filters: a
  comma-separated `type` set, `status`, a label substring `q`, and folder
  (`unfiled=true` or an exact `folder` path). The cursor keys on `rowid`, so a
  background import appending rows never shifts a page already scrolled past, and a
  deletion before the cursor never skips a live row.
- `GET /api/cases/{id}/catalog/summary` returns `{total, by_type, by_status,
  by_folder}` without shipping the graph.
- `GET /api/cases/{id}/entities/{id}/chain` (neighbour derivation),
  `GET /entities/lookup` (one entity by attribute), and
  `GET /entities/{id}/derivation` (transitive `derived-from` closure) are the
  bounded single-entity reads, each built on `links_of` rather than the whole
  graph.

The sidebar pages the catalog through `buildCatalogQuery` and uses a generation
guard, so a stale page never lands after a case or filter switch.
`fetchAllEntities` walks the pages server-side for the whole-slice cases and
accepts an `AbortController` signal; `lookupEntity` and `fetchDerivation` cover
the single-entity and closure cases. These helpers live in
`frontend/src/lib/catalog.js`. The sidebar, `Files`, `Notebook`, `Satellite`,
`Media Library`, `Inspector` and the composers use them; none loads
`caseState.current.entities`/`.links`, which no longer exist on the case-open
response.

Deferred to their first consumer: date filters (a timeline filter), links
pagination (a relations/graph view), and notes/label full-text search (gated on
per-binary FTS5).

## Thumbnails and background jobs

Thumbnails are disposable pixels: a broken or missing one never blocks access to
the original. `engine/thumbnails.py` owns their whole lifecycle, and the durable
`jobs` table is the general background-work model behind it (EXIF, OCR and
transcripts will reuse it).

### Cache identity, atomic generation

A thumbnail's file name folds in the original's SHA-256 and the generator version
(`THUMB_GEN`): `media/.thumbs/<sha[:24]>-g<gen>.jpg`. A changed original or a
bumped generator therefore maps to a *new* file rather than serving stale pixels;
the superseded ones become orphans that `repair` sweeps. Pixels are rendered to a
unique temp file, validated, then renamed into `.thumbs/`. Readers never see a
half-written thumbnail, and the Windows rename rules hold. Images decode through
the process-wide Pillow pixel clamp.

### Inline for cheap, queued for heavy

A registered image gets its thumbnail rendered inline with Pillow. Videos use the
CPU-heavy ffmpeg path and are queued, as are images whose inline render fails.
Jobs are keyed on media path, so retrying or regenerating does not stack duplicates.

### One worker, recoverable

A single background worker drains thumbnail jobs, so only one ffmpeg process runs
at a time.
Work starts only from a user action (an import, a regenerate) or crash recovery,
never from merely opening a case or tab. A job lifecycle is `queued → running →
ready`, or `failed` once its retry budget is spent, or `cancelled` (its media is
gone). A job left `running` by an interrupted process is reclaimed to `queued` (or
`failed`) on case open and on server startup (`Case.recover_jobs`,
`server._recover_jobs`), so work resumes instead of stalling.

### Budget, repair, retry states

`prune_cache` evicts least-recently-used thumbnails (by mtime) past a size budget;
`repair` removes abandoned temp files and orphaned thumbnails no live sidecar
references. Both only ever touch the cache, never originals or database rows. A
content-addressed thumbnail can be shared by identical-bytes captures, so deleting
one media file drops the cached thumbnail only when no surviving sidecar still
points at it.

The media listing tags each item with a `thumb_state` (`ready`, `queued`,
`running`, `failed`, or `none`). The Media Library renders the image when ready
(lazy-loaded, async-decoded, with an `onerror` fallback to the type icon that
reports once and does not retry per render), a "Generating…" placeholder while
queued, and a retry affordance on failure. `POST
/api/cases/{id}/media/thumbnails/regenerate` re-queues one item (the per-card
retry) or every missing/failed one; the grid polls the listing while anything is
pending, and stops on its own once nothing is.

## Filesystem and database consistency

SQLite cannot atomically commit a filesystem rename, so file-backed operations are
recoverable. Creation produces a file under a unique temp name, validates it,
renames it to its final path, then registers it in a short transaction. Deletion
removes the file and sidecar, then settles the database. Thumbnail generation
follows the same temp-then-rename discipline. The rollback journal means a copied
closed case is always complete.

## Performance

The reference profile for absolute timings is a modest machine (four logical
cores, 8 GB RAM, integrated graphics, SATA-class drive); the exact machine and
versions belong in the benchmark report. The large-case fixture
(`tests/bigcase.py` `build_big_case`, driven by `bench/case_baseline.py`, standard
library only, outside the wheel) builds 10k entities / 20k links / 5k media with
nested folders, notes, suggestions, unknown types, mixed thumbnail states, proof/
post/Inspect artifacts, missing files and tombstones. It writes `case.json` in one
pass (the per-item path is the O(n²) cost being measured) and is seeded, so the
same arguments produce byte-identical rows.

Interaction budgets on the reference machine:

| Operation | Target |
|---|---:|
| Open case and render the first useful page, cold | 2 seconds or less |
| Open case, warm filesystem cache | 750 ms or less |
| Return a warm filtered/search page | 300 ms or less |
| Update one metadata record | 200 ms or less |
| Mounted catalog rows/cards | 300 or fewer |
| Default CPU-heavy background jobs | 1 at a time |

These are starting budgets, not release claims: absolute timings are a manual
release check because shared CI hardware varies, while relative regressions can be
made to fail CI against a recorded baseline.

### Captured baselines (fast dev machine, not the reference profile)

Read the shape, not the absolute milliseconds. At the default size (10k / 20k /
5k), the old monolithic `case.json` was **8.4 MB** and case open shipped **~6 MB**
of graph to the browser; every single mutation was **~244 ms** because it
read-modify-wrote the whole file (linear in case size). On the SQLite backend a
single `add_entity` is **~5.5 ms** (one durable row, roughly flat with case size),
a `get_entity` is a **0.15 ms** indexed read, and converting a 5k-entity case runs
once in **~233 ms**. Case open no longer ships the graph at all. The
reference-machine capture remains a manual release step.

## How it is verified

- **Graph contract** (`tests/test_repository.py`): entity/link/folder CRUD,
  dedupe, `sync_links` id preservation, folder subtree removal, cursor paging and
  summaries, the derivation closure, and the durable job queue (idempotent
  enqueue, claim, retry-then-fail, recover, prune) held against `Case`
  (SQLite-backed).
- **Store specifics** (`tests/test_sqlite_backend.py`): create/open, newer-schema
  refusal, foreign keys, rollback, the in-place schema upgrade through every
  migration, keyset paging, and the atomic converter (roundtrip, dangling-link
  report, failure leaves no db, large-case integrity).
- **Migration** (`tests/test_migrations.py`): legacy json → sqlite on open, backup
  recoverability, a failed activation leaving the json case usable, forward-compat
  refusal.
- **Thumbnails and jobs** (`tests/test_thumbnails.py`, `tests/test_media_api.py`):
  inline vs queued, atomic generation with no partial/temp on failure, content-key
  by generator version, drain + retry-then-fail, cancel on missing media, LRU
  budget eviction, orphan/temp repair, shared-thumbnail delete safety, the
  background worker, startup recovery, and the `thumb_state` + regenerate API.
- **Release gate** (`tests/test_release_gate.py`): a legacy case migrates and every
  workflow answers, a closed-case folder copy opens identically, a large migrated
  case opens through bounded queries, and the frozen-binary packaging constraints
  hold.
- **Frontend** (vitest + svelte-check + the production build): first-page paging,
  request cancellation on case switch, and the thumbnail placeholder/failure/retry
  markup.

The backend suite runs on Python 3.11 and the three release operating systems.

## Manual release steps

Two parts of the release gate are inherently manual and are done at release time,
not in CI:

- Record the reference-machine numbers (the profile above) and calibrate the
  relative CI thresholds against them.
- Migrate several disposable real-world case copies end to end and confirm every
  workflow before tagging.

## Roadmap compatibility

Later tools reuse this storage, job and event model rather than inventing their
own: EXIF/OCR/transcript jobs on the durable queue with text artifacts and a
future full-text index; the Notebook's file-backed content with indexed text and
entity references; Board/Relations over indexed entities and typed links; Map and
Timeline over geographic and temporal projections added when their first query
lands; the Evidence Locker exporting committed events idempotently to
`evidence.jsonl`; cross-case search over a rebuildable workspace index. New typed
projections arrive with their own migration and tests; the core identifiers,
provenance and link rules stay stable.
