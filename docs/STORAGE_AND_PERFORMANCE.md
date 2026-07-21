# Case storage and performance migration

This document plans the move from a monolithic `case.json` to a per-case
SQLite database. The goal is to keep every existing workflow intact while
making large cases comfortable on modest computers.

The migration changes structured case data only. Images, videos, proof PNGs,
drafts and saved Inspect sessions remain ordinary files inside the case
folder.

## Goals

- Open a case without loading its full catalog into Python or the browser.
- Keep metadata edits fast as the number of entities and links grows.
- Bound CPU and memory use during thumbnail generation and media analysis.
- Preserve the current local-first, portable case folder.
- Migrate old cases automatically without moving or rewriting their media.
- Give future EXIF, OCR, transcript, timeline, map and evidence tools one
  durable storage and job model.
- Keep unknown entity and link types readable so the ontology remains
  extensible.

## Non-goals

- Media bytes do not move into SQLite.
- Migration does not change image or video codecs.
- SQLite is not a reason to load every row and render every card at once.
- This work does not add cloud storage, telemetry or background network calls.
- The first migration does not need to implement every future entity
  attribute. It must leave room for versioned additions.

## Target case layout

```text
case.json       # small manifest: name, dates, format and compatibility
case.db         # entities, links, folders, catalog, jobs and events
notes.md        # current case notes; later indexed for Case Notebook
media/          # imported, downloaded and derived media
proofs/         # editable proof specs and rendered PNGs
exports/        # post drafts, reports and case bundles
inspect/        # saved Inspect session specs
.thumbs/        # disposable thumbnail cache
evidence.jsonl  # future portable evidence journal
```

`case.json` remains the discovery manifest. It owns the case name, creation
date and storage compatibility fields. It no longer contains the entity graph.
Keeping this small file lets the case switcher identify a case without opening
its database.

`case.db` becomes the source of truth for mutable structured state. The files
under `media/`, `proofs/`, `exports/` and `inspect/` remain the source of truth
for their content.

Media sidecars keep immutable acquisition and technical metadata that belongs
with a file. Mutable catalog fields such as title, notes and folder move to
the database. The migration imports existing values and the storage layer
becomes the only code allowed to change them.

This is a deliberate change to the current SPEC rule that limits SQLite to
rebuildable caches. `docs/SPEC.md` and `docs/ONTOLOGY.md` must be updated in the
implementation change that activates the new format.

## Ownership rules

Each value has one owner. Cached copies may exist, but they must be disposable
and carry enough information to detect when they are stale.

| Data | Owner | Notes |
|---|---|---|
| Case name and storage version | `case.json` | Small manifest, atomically replaced |
| Entities, links and folders | `case.db` | Transactional and versioned |
| Mutable titles and notes | `case.db` | Never duplicated into a writable sidecar |
| Image, video and audio bytes | Filesystem | Never stored as database blobs |
| Proof and session content | Their JSON/PNG files | Registered as artifacts in the database |
| Acquisition provenance | Media sidecar | Immutable after registration |
| Search rows | SQLite index tables | Rebuildable from owned data |
| Thumbnails | `.thumbs/` | Cache; safe to remove at any time |
| Cross-case search | Workspace index | Rebuildable from each case |
| Evidence export | `evidence.jsonl` | Produced from committed event records |

## Database shape

The first schema should stay small. New roadmap tools add migrations when they
need new indexed concepts.

### Core tables

`meta`
: Database schema version, ontology version and creation information.

`schema_migrations`
: Every applied migration, its version and completion time.

`entities`
: `id`, `type`, `label`, `attrs_json`, provenance fields and status. Unknown
  types and attributes remain valid.

`links`
: `id`, source entity, target entity, type, provenance fields and status.
  Foreign keys prevent links to missing entities. Delete policy remains in the
  existing dependency-aware service rather than in a blind SQL cascade.

`folders`
: Normalized logical paths for the analyst's organisation. These are not
  filesystem directories and are not semantic links.

`artifacts`
: Entity, safe relative path, media kind, MIME type, size, SHA-256 and source
  metadata needed by catalog queries. Paths are unique within a case.

`jobs`
: Durable local work such as thumbnails, EXIF extraction, OCR, transcription
  and video analysis. Stores state, progress, retry count and a short error.

`events`
: Committed case changes that can feed the future Evidence Locker and its
  `evidence.jsonl` export. An event identifier makes export idempotent.

### Indexes

The initial schema needs indexes for:

- entity type, status and creation time;
- link source, target and type;
- artifact path, hash and media kind;
- folder path;
- job state and requested time.

Full-text search is added over labels, notes and selected metadata. Geographic
and temporal projections should be added when the first map and timeline
queries land. Generic attributes stay in JSON until a real workflow needs an
indexed, typed field.

Use the SQLite support shipped with Python. Any reliance on FTS5, JSON or RTree
must be tested on the Windows, Linux and macOS release matrix before it becomes
part of the storage contract.

### Connection policy

- Enable foreign keys on every connection.
- Set a bounded busy timeout instead of failing immediately on a short write.
- Keep transactions short. File hashing and ffmpeg work happen outside them.
- Start with SQLite's rollback journal and `synchronous=FULL`. The app is
  single-user and portability matters more than speculative write concurrency.
- Benchmark WAL before adopting it. If WAL is ever enabled, case close and
  export must checkpoint it so a copied case is complete.
- Create live backups through SQLite's backup API. A manual folder copy is only
  guaranteed when the case is closed.
- Apply restrictive file permissions through the existing workspace helpers.

## Storage boundary before migration

The first implementation step is not SQL. Introduce one repository boundary
for every case operation:

- read case summary;
- list, get, add, update and remove entities;
- list, add and remove links;
- manage folders;
- register and update artifacts;
- resolve paths to entities;
- plan and apply dependency-aware deletion;
- enqueue and update local jobs.

The API and tools call this boundary. They no longer read or rewrite
`case.json` directly. A JSON-backed repository keeps the current behavior while
the boundary is introduced. The SQLite implementation then replaces it without
requiring every tool to change at once.

Direct storage access should fail review after this phase. Tests may inspect
fixtures and migration output, but production tools use the repository.

## Automatic migration

The conversion is one-way for normal use. A backup makes it recoverable, and
the legacy importer remains available indefinitely.

### Format versioning

Storage format and ontology version become separate concepts. The new manifest
must still carry a higher compatibility schema so an older Azimut refuses to
open it instead of treating it as an empty case.

The new application supports:

- opening and migrating legacy JSON cases;
- opening current SQLite cases;
- refusing a database created by a newer unsupported schema;
- importing a retained legacy backup for recovery.

It does not dual-write JSON and SQLite in production. Dual writes create two
authoritative copies and make crash recovery ambiguous.

### Conversion sequence

1. Acquire the existing per-case lock.
2. Read and validate the legacy `case.json`.
3. Check free disk space for the small database and its temporary copy.
4. Create a uniquely named, versioned JSON backup without overwriting an older
   backup.
5. Build `case.db.tmp` with the target schema.
6. Import entities, links, folders and artifact references in one database
   transaction.
7. Import mutable media fields from existing sidecars.
8. Validate row counts, identifiers, relative paths and link endpoints.
9. Run `foreign_key_check` and `integrity_check`.
10. Commit and close the temporary database.
11. Atomically rename the temporary database to `case.db`.
12. Atomically replace `case.json` with the new manifest.
13. Reopen the case through the normal SQLite repository and compare its
    summary with the migration report.

The manifest changes last. A crash before that point leaves the legacy case as
the active format. A complete but unreferenced temporary database can be
validated and reused or safely replaced on the next attempt.

Do not rehash every large video during migration. Import the recorded hash,
verify file existence and offer a separate integrity scan. Forced rehashing
would make the first launch unexpectedly expensive on a slow disk.

### Migration validation

The migration report records:

- entity, link and folder counts;
- artifact and sidecar counts;
- missing files and unresolved paths;
- duplicate identifiers or paths;
- links whose endpoints are missing;
- database integrity results.

Missing media is reported but does not erase its entity or provenance. Existing
dependency and tombstone rules remain in force.

If validation fails, the manifest is not changed. The user sees a short error
with the recovery location, and the legacy case remains available.

## API and frontend migration

SQLite only helps the interface when queries and rendering are bounded.

### Compatibility pass

First, keep current API responses unchanged and run them against both storage
implementations. This isolates storage regressions from UI changes.

### Bounded catalog API

Add cursor-based endpoints for entities, media and links with:

- stable ordering;
- a default and maximum page size;
- type, folder, status and date filters;
- server-side search;
- summary counts returned separately;
- direct lookup by identifier.

Cursor pagination avoids shifting pages when an import adds a new item. Offset
pagination is acceptable only for small, static lists.

Once every consumer has moved, the case-open response stops embedding the full
entity and link arrays. It returns the manifest, counts and the first data
needed by the active view.

### Bounded rendering

- Fetch the first page only when a tool becomes visible.
- Keep a small in-memory cache keyed by entity identifier.
- Load more rows as the user approaches the end of the visible list.
- Limit mounted media cards. Add simple windowing if progressive pages still
  leave too many DOM nodes.
- Preserve selection by identifier, not by list position.
- Run filters and full-text search in the backend.
- Cancel stale requests when the user changes case or query.

This work must not introduce a frontend dependency unless it has compatible
prebuilt support requirements and earns its maintenance cost. A small local
list window is preferable if it covers the current layouts.

## Thumbnail and background-job model

Thumbnails are disposable. A broken thumbnail must never block access to the
original file.

### Cache identity

A thumbnail key includes:

- original artifact identifier and SHA-256;
- requested size or variant;
- thumbnail generator version.

Changing the original file or generator therefore schedules a new result
instead of serving stale pixels.

### Job states

Use at least `queued`, `running`, `ready`, `failed` and `cancelled`. A job also
stores attempts, timestamps, progress where available and a short diagnostic.
On startup, an interrupted `running` job returns to `queued` or `failed`
according to its retry policy.

### Generation rules

- Generate visible and newly imported items first. Do not rebuild the entire
  case during open.
- Default to one CPU-heavy worker on modest hardware. A preference may allow
  more, but foreground interaction keeps priority.
- Bound ffmpeg execution time and remove partial output after failure.
- Decode images through the existing pixel clamp.
- Write to a unique temporary file, validate the result, then rename it into
  `.thumbs/` atomically.
- Store a concise error and retry with a limit. Never loop forever.
- Provide a manual regenerate action for one item or the whole cache.
- Apply a configurable cache-size budget and evict least-recently-used results.
  Eviction never touches originals or database records.

### UI failure behavior

- Use lazy image loading and asynchronous browser decoding.
- Show a type-specific placeholder while queued or after failure.
- A failed `<img>` request switches to the placeholder and reports the stale
  cache entry once. It does not retry on every render.
- Keep title, provenance and actions usable without a thumbnail.
- Expose retry without turning a technical failure into a blocking dialog.

The same durable queue later runs EXIF parsing, OCR, transcripts, perceptual
hashes and other local analysis. Each job begins only after a user action that
requires it; opening a tab does not create network work.

## Filesystem and database consistency

SQLite cannot atomically commit a filesystem rename. File-backed operations
therefore follow a recoverable sequence.

For creation:

1. Produce the file under a unique temporary name.
2. Validate and hash it.
3. Rename it to its final path.
4. Register it in a short database transaction.
5. Reconciliation removes abandoned temporary files and registers or reports
   untracked final files according to the operation journal.

For deletion, first rename the file into a case-local trash/staging directory,
then commit the database deletion, then remove it. A crash leaves a recoverable
staged file. This also follows Windows rules for open files and directory
replacement.

An inexpensive reconciliation pass checks pending operations when a case
opens. Full hashing and media probing stay behind an explicit integrity scan.

## Performance budgets

Performance work needs a repeatable fixture and a reference machine. Use a
modest profile such as four logical CPU cores, 8 GB of RAM, integrated graphics
and a SATA-class drive. Keep the exact machine and software versions in the
benchmark report.

The initial large-case fixture should contain:

- 10,000 entities;
- 20,000 links;
- 5,000 registered media items and sidecars;
- nested folders, notes, suggestions and unknown entity types;
- ready, missing, corrupt and failed thumbnails;
- proof, post and Inspect artifacts;
- missing source files and dependency tombstones.

Large binaries can be sparse fixtures or small synthetic files. Separate
benchmarks cover real image decoding and video thumbnail extraction.

Initial interaction targets on the reference machine:

| Operation | Target |
|---|---:|
| Open case and render the first useful page, cold | 2 seconds or less |
| Open case, warm filesystem cache | 750 ms or less |
| Return a warm filtered/search page | 300 ms or less |
| Update one metadata record | 200 ms or less |
| Mounted catalog rows/cards | 300 or fewer |
| Default CPU-heavy background jobs | 1 at a time |

These are starting budgets, not release claims. Record the current JSON
baseline first, calibrate the reference device, then make regressions fail CI
using stable relative thresholds. Absolute timings remain a manual release
check because shared CI hardware varies.

Also track peak backend memory, browser memory, query count, long browser tasks
and thumbnail queue depth. Memory use for the first page must not grow linearly
with the total case catalog.

## Test plan

### Characterization

Pin current behavior before changing storage:

- case creation, rename, promotion and deletion;
- entity and link CRUD;
- unknown entity and link types;
- folders and unfiled items;
- suggested and confirmed status;
- media import, download, deduplication and sidecars;
- proof, post and Inspect save/reopen;
- dependency-aware delete and tombstones;
- concurrent media registration;
- notes and provenance updates.

### Migration fixtures

Keep small legacy cases in the test suite with Unicode, unusual paths, absent
optional fields, unknown types, missing files and valid derivation chains.
Compare their public API results before and after migration.

Test failure after every conversion stage. Reopening must either finish the
migration or leave the JSON case untouched. It must never expose a half-filled
database as current.

### Database behavior

- constraints and foreign keys;
- rollback on failed writes;
- concurrent readers and short writers;
- unsupported newer schema refusal;
- sequential schema upgrades;
- backup and restore;
- corruption detection;
- cross-platform path handling and permissions.

### Frontend and load tests

- first-page rendering without a full-case fetch;
- pagination stability while imports arrive;
- selection across page loads;
- fast case switching with stale-request cancellation;
- broken and missing thumbnail fallbacks;
- bounded DOM and memory use;
- no network request merely from opening a case or tab.

Run the backend suite on Python 3.11 and the three release operating systems.
Run frontend unit tests, checks, the production build and targeted Playwright
coverage for scrolling, selection and thumbnail failure.

## Roadmap compatibility

The storage work is successful only if later tools reuse it.

| Roadmap work | Storage support |
|---|---|
| EXIF and metadata | Local jobs emit suggested place/event entities |
| OCR and transcript | Durable jobs, text artifacts and full-text index |
| Case Notebook | File-backed content with indexed text and entity references |
| Case Board / Relations | Indexed entities, typed links and reversible `same-as` |
| Map Board | Place entities plus indexed geographic projections |
| Timeline Builder | Event entities plus indexed time projections |
| Evidence Locker | Committed events exported idempotently to `evidence.jsonl` |
| Report Builder | Stable artifact identifiers and derivation links |
| Cross-case search | Rebuildable workspace index over closed case summaries |
| Search Orchestrator | Durable jobs and analyst-confirmed suggestions |
| Déjà Vu | Perceptual hashes indexed without loading media bytes |
| Channel Monitor | Bounded persistent queue with explicit network actions |

Do not pre-build all of these tables now. Add typed projections when the first
real query needs them, with a schema migration and tests. The core identifiers,
provenance and link rules must remain stable.

## Delivery sequence

### 1. Baseline and contract

- Add the large synthetic fixture and benchmark commands.
- Capture current JSON timings and memory.
- Finalize ownership and compatibility fields.
- Add characterization tests where behavior is not already pinned.

### 2. Repository boundary

- Add the storage interface and JSON implementation.
- Move all case graph and catalog access behind it.
- Keep API responses and frontend behavior unchanged.

### 3. SQLite implementation

- Add schema creation, migrations, indexes and backup helpers.
- Run the same repository contract tests against JSON and SQLite.
- Add the converter and crash/failure tests.

### 4. Safe activation

- Enable migration on case open.
- Keep the legacy importer and JSON backup.
- Update SPEC, ONTOLOGY, UI documentation and case-tree examples.
- Verify Windows, Linux, macOS and Python 3.11.

### 5. Bounded loading

- Add paginated endpoints and server-side filters.
- Change frontend stores to summary plus page caches.
- Add progressive loading, request cancellation and DOM bounds.

### 6. Job and thumbnail hardening

- Add the durable queue and one-worker default.
- Make thumbnail generation lazy, atomic and recoverable.
- Add cache budgeting, repair and visible retry states.

### 7. Release gate

- Run functional, migration, load and packaging tests.
- Test copies, backups and case bundles.
- Migrate several disposable real-world case copies.
- Record the reference-machine results.
- Ship only when the new format matches all current workflows and meets the
  agreed performance budgets.

The legacy importer is permanent. The JSON writer can be removed after the
SQLite release is stable, but opening an untouched old case must continue to
work.

## Completion criteria

The migration is complete when:

- existing cases migrate automatically with a retained backup;
- no production tool reads or writes the old graph arrays directly;
- all current workflows pass unchanged;
- older applications refuse the new format safely;
- a failed migration leaves the original case usable;
- case opening and lists use bounded queries and bounded rendering;
- thumbnail failures never block media access;
- the large-case fixture meets the reference performance budgets;
- the documented v2, v3 and v4 workflows fit the storage, job and event model;
- the full frontend and backend validation paths pass on supported platforms.
