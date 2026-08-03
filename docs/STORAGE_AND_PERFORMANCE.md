# Case storage and performance

This document describes current case storage and the controls that keep large
cases responsive. The migration from a monolithic `case.json` graph to per-case
SQLite is complete.

Structured case data lives in SQLite. Images, videos, proof PNGs, drafts, saved
Inspect sessions and note bodies remain ordinary files inside the case folder.

## The shape of the workspace

```text
<workspace>/
  <case>/                    # one visible folder per permanent investigation
  .azimut/                   # hidden application machinery
    bundles/                 # exported bundles and transient imports
    cache/tiles/             # disposable map tile cache
    lock                     # held by the one Azimut using this workspace
    runtime/                 # updated scraper distributions
    scratch/                 # complete, promotable one-shot cases
    settings/                # preferences, templates, branding and cookies
```

Startup migrates the former `cases/`, `scratch/`, `bundles/`, `runtime/` and
`tile-cache/` directories with restartable renames. Permanent cases move to the
workspace root; scratch cases move under `.azimut/scratch/` and then run through
the same case-schema migration as permanent cases before cleanup. Different
entries at the same destination stop the move without overwriting either copy.

## Where the workspace is

Nothing inside a workspace records where it is: media are stored as
`media/photo.png`, and settings hold keys and preferences. So the answer lives
outside it, in a one-line pointer file at the platform's own configuration
location — `$XDG_CONFIG_HOME/azimut/location` on Linux, `~/Library/Application
Support/Azimut/location` on macOS, `%APPDATA%\Azimut\location` on Windows.
Resolution order is `AZIMUT_HOME`, then that pointer, then `~/Azimut`. The
environment variable stays in front so a workspace on a stick keeps working
without rewriting the machine's configuration, and a stale pointer cannot stop a
run that was told where to look.

A lost or unreadable pointer costs an address, not data: Azimut falls back to
the default root, and pointing it at the real folder again is one action. A
pointer naming a folder that is *not there* is the other case, and it stops
startup: nothing is created, case routes answer 503, and the browser shows where
the folder was expected. Recreating it silently is how someone concludes their
work is gone.

### One Azimut per workspace

A workspace holds `.azimut/lock`, and the process that opens it holds an advisory
lock on that file — `fcntl.flock` on Linux and macOS, `msvcrt.locking` on
Windows. The reason it is an OS lock rather than a file Azimut writes and deletes
is that **the kernel drops it when the process dies**, so a crash can never leave
a workspace nobody can open. It is taken before startup migrates anything, since
two processes renaming case directories at once is the damage it exists to
prevent, and it moves with the root when a folder is adopted or a move finishes.

That lock is unreliable on exactly the filesystems this matters for, NFS, SMB and
cloud-sync folders, so the file also carries who holds it and a heartbeat rewritten
every 30 seconds. The two are read together: a refused lock means someone holds
it; a granted lock over a payload from *another* machine whose heartbeat is under
five minutes old means the lock was probably a no-op, so the payload wins; an
older heartbeat, or any payload naming this machine, is a corpse to take over.
Two machines' clocks can disagree in a way nothing here can fix, so Settings can
always overrule the verdict.

The port was never this guarantee. A second instance on the same machine failed
to bind 8477 and died, which protects the port; `azimut --port 8478` and two
machines on one share never noticed. What breaks without the lock is not SQLite,
whose own locking and `busy_timeout` hold on a local disk, but everything around
it: `settings.json` read-modify-written per process loses an API key to the last
writer, and startup migrations race over the same renames.

Settings can adopt a folder as it is, or move the workspace into it. Adopting
writes the pointer and nothing else, which is what a folder moved by hand needs.
A move copies, verifies every file's name, size and SHA-256 while rejecting a
source that changes during the read, renames the copy into place, then
writes the pointer — that write is the whole switch, so an interruption before
it leaves the old folder authoritative and one after leaves the new one, both
complete. The old folder is then renamed `<name>.old-<date>` and kept until the
analyst drops it. The tile cache is not copied, being disposable by contract,
and a destination that already holds other files gets an `Azimut` subfolder
rather than settling among them. Choosing a root is also where the path budget
below is enforced: `layout.room_for_workspace_root()` refuses a root too long
for a case to fit under it on Windows, and names it as a warning elsewhere.

## The shape of a case

```text
<case>/           # the analyst's: Azimut writes nothing here but azimut/
  README.txt      # which half of the folder is whose
  azimut/
    case.json     # small manifest: name, dates, storage format and schema
    notes.md      # case-wide Markdown note
    notes/        # note bodies, named after their title, filed as in the notebook
    media/        # imported, downloaded and derived media
      .meta/      #   one sidecar per media
      .dl/        #   in-progress downloads (transient)
      .thumbs/    #   disposable thumbnail cache
    proofs/       # rendered PNGs
      .meta/      #   editable specs and pasted assets
    exports/      # what the analyst exports: notes as PDF, and their own files
    .data/        # case.db: entities, links, folders, catalog and jobs (SQLite)
    .drafts/      # post drafts
    .inspect/     # saved Inspect session specs
    .search/      # saved Grid Search state
    .trash/       # deleted artifacts grouped by delete action, in numbered slots
```

Paths are stored relative to `azimut/`, not to the case folder: a media is
`media/x.png` in the graph, in its sidecar and in a bundle. That is what let the
wrapper arrive without rewriting a stored path, and what keeps bundles written
before it importable after it.

Visible means openable and useful in another program; a dot-directory means only
Azimut reads it. `ensure_dir` adds `FILE_ATTRIBUTE_HIDDEN` to those, since a
leading dot means nothing to Windows Explorer. The attribute belongs to the
directory rather than to its name, so a rebuilt tree loses it: opening a case
puts it back over `layout.hidden_dirs()`, which is what covers a workspace
copied from another machine.

`layout.py` owns this shape. It answers where each file goes for a given case
root and carries the path budget — the caps on case, media, document and folder
names that keep a case's longest path inside Windows' 260-character limit.
`tests/test_layout.py` recomputes the budget from those caps and fails when a
new directory level or a raised cap breaks it.

`case.json` is the discovery manifest: name, creation date, and the storage and
schema fields. It no longer holds the graph, so the case switcher can identify a
case without opening its database. `case.db` is the source of truth for mutable
structured state (entities, links, folders, jobs). The files under `media/`,
`proofs/`, `.drafts/`, `.inspect/` and `notes/` are the source of truth for their
own content.

App-wide preferences stay outside cases under `<workspace>/.azimut/settings/`:
`settings.json`, `templates.json`, `signature.png` and the optional
`cookies.txt`. Startup moves the former workspace-root or `.settings/` files
there with independent atomic renames, so a partial move resumes. If both
locations differ, the current hidden file wins and the legacy copy is retained
beside it under a `.legacy` name.

For media, proof PNGs, notes, drafts and Inspect sessions, the human-readable
filename stem is the name Azimut shows. Spaces, case and Unicode survive;
characters forbidden by Windows are replaced and the returned canonical stem
is written back to the UI. Renaming moves the file and its companions, rewrites
exact stored paths in the graph, jobs, sidecars and tool specs, and rebinds the
same entity. A rename onto a name another item holds is refused before anything
moves.

Every mutation used to re-read and rewrite the whole `case.json` under a per-case
lock. At 10k entities that rewrote megabytes per edit and shipped the entire
graph to the browser on open. SQLite removes both ceilings: a single edit touches
one row in one short transaction, and case open ships a manifest instead of a
graph.

## Source of truth

`case.db` owns the graph. A case bundle is the portable snapshot: a cleaned
database plus declared files under a SHA-256 manifest. Rollback journaling leaves
no WAL checkpoint outside the case folder. Media, proofs and note bodies remain
inspectable files.

## Case Doctor

The case switcher can inspect a permanent or scratch case without opening its
database. Discovery reads `case.json`, so renaming the outer case folder does
not orphan it. Diagnosis is read-only and reports:

- a missing or unreadable `case.db`;
- media and capture entities whose file no longer exists;
- visible files placed directly in `media/` without a graph entity.

Repairs are separate API actions. A deleted database is rebuilt in a temporary
SQLite file from media sidecars, note files and proof specs, then renamed into
place only after the rebuild completes. Relations, catalog folders and
database-only provenance cannot be recovered and the dialog says so first.
Missing media can be removed through the normal Trash path or rebound to an
unregistered file already inside `media/`. An unknown file goes through the
normal media registration pipeline, gaining a hash, sidecar, index row and
provenance. None of these actions runs at startup, on case open or during a
diagnostic request.

## Ownership rules

Each value has one owner. Cached copies may exist, but they are disposable and
carry enough information to detect staleness.

| Data | Owner | Notes |
|---|---|---|
| Case name and storage version | `case.json` | Small manifest, atomically replaced |
| Entities, links and folders | `case.db` | Transactional and versioned |
| Entity labels and notes | `case.db` | Indexed for catalog search; file-backed labels mirror their filename stem |
| Media visible name | Media filename stem | Mirrored as `title` to the sidecar, graph and browse index |
| Media notes and folder | Media sidecar | Mirrored to the graph and browse index |
| Image, video and audio bytes | Filesystem | Never stored as database blobs |
| Proof and session content | Their JSON/PNG files | Registered as artifacts in the database |
| Acquisition provenance | Media sidecar | Immutable after registration |
| Media browse fields | `case.db` (`media_items`) | Search index mirrored from sidecars |
| Background jobs | `case.db` (`jobs`) | Durable, recoverable, one worker |
| Trash journal | `case.db` (`trash`) | One row per delete action; payload loaded only for restore |
| Deleted artifact bytes | `.trash/<group>/` | Numbered slots paired to their origin by the journal, retained until purge |
| Thumbnails | `media/.thumbs/` | Cache; safe to remove at any time |
| Note bodies | `notes.md`, `notes/<folder>/<title>.md` | Graph keeps only id, title, folder, path; uniqueness is per folder |

## Packaging and frozen-binary constraints

The same storage layer serves `pip install azimut` and PyInstaller binaries for
Windows, macOS and Linux:

- **Bundle encryption uses `cryptography`.** Intel macOS resolves the latest
  compatible 48.x universal wheel; other platforms resolve 49.x. Both ranges
  are bounded below the next untested major. SQLite remains the stdlib
  `sqlite3` module.
- **Feature availability is per-binary, not per-Python.** `sqlite3` links whatever
  SQLite the build environment provides, so FTS5, JSON1 and RTree can be present
  on the dev machine yet missing from a shipped binary. The store stays on core
  SQL: `find_entity` scans and matches attributes in Python rather than relying on
  JSON1. Any future indexed projection (geo, time, full-text) is probed at runtime
  with a `LIKE`/scan fallback before it enters the contract.
- **`case.db` lives under the workspace root**, inside the case folder, never
  beside the frozen executable, which may sit on read-only media.
- **Dev-only tooling stays out of the artifact.** The synthetic fixture
  (`tests/bigcase.py`) lives outside `src/azimut/`, so hatchling never packages
  it, and uses only the standard library.

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

`case.db` is at SQLite schema 7. The schema counter is independent of the JSON
`CASE_SCHEMA`: the manifest's `azimut.storage` field selects the backend, and each
format counts its own shape upgrades.

The case manifest is at `CASE_SCHEMA` 9. Schema 3 is the last released folder
shape before the `azimut/` boundary; schemas 4–8 were development checkpoints
and never became public formats. `FolderMigration` therefore declares a target
schema instead of assuming `+1`: every schema-3 case and any development case at
4–8 runs the same idempotent normalizer and is stamped 9 only after the whole
layout and visible-name contract are valid. A stopped migration keeps its older
stamp and resumes the same normalizer on the next open. Media moves additionally
use `.data/rename.json`, so a restart can finish references after the bytes moved.

### Tables

`meta`
: Schema version, case name and timestamps.

`schema_migrations`
: Every applied SQLite-schema migration and its completion time.

`entities`
: `id`, `type`, `label`, `attrs_json`, an indexed `folder` (denormalised from
  `attrs.folder`), denormalised search text, provenance fields and status.
  Search covers label, type, folder and notes. Unknown types and attributes stay
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

`trash`
: One head row per delete action (`id`, time, label, type, item count and byte
  size), a recovery state and a JSON restore recipe. Sidebar listing reads only
  completed groups and never loads the recipe.

`media_items`
: Queryable browse metadata mirrored from each media sidecar. It indexes path,
  kind, folder, display name, size, date, source, imagery mode, the media entity
  it belongs to and whether the file states a position (`has_gps`). The
  coordinates themselves travel in the mirrored sidecar JSON and need no column;
  presence does, because "only the files that carry a position" has to filter over
  the whole case rather than over the page the client holds. Enrichment's full
  metadata dumps (`exif`, `video_metadata` — hundreds of rows per file) are the
  one thing the mirror leaves out: this index is read 200 rows at a time by the
  grid and whole by the pickers, and one fat field would multiply every one of
  those responses. A surface showing a single file reads it from the sidecar
  through `GET /api/cases/{id}/media/item`. The original files and sidecars remain
  the file-level records.

### Indexes and migrations

Indexes cover entity type/status/folder, link source/target/type and media browse
fields. Job state and a partial unique index on `(kind, job_key)` keep a keyed
job from being enqueued twice. `SqliteCase.open` upgrades an older `case.db` in place
through `_SQLITE_MIGRATIONS`, each step in its own immediate transaction, re-reading
the version inside the transaction so a raced second opener applies nothing; a
newer schema is refused rather than mangled. The shipped migrations add the
indexed `folder` column (1→2), the `jobs` table (2→3), entity search text and
the media browse index (3→4), the `has_gps` flag (4→5), the trash journal
(5→6), then interrupted-operation recovery state (6→7). The 4→5 backfill
reads the sidecar JSON already held in each index row, so a case enriched before
the column existed gains its position filter on open with no file scan.

The schema-4 media backfill scans sidecars once on first open. Its completion
marker and index rows commit together, so an interrupted backfill retries safely.
Normal media creation, edits, thumbnail changes and deletion keep the index in
sync.

## Trash and artifact ownership

`engine/artifacts.py` is the single declaration of files owned by each entity
type. Delete writes a recovery journal before moving files to `.trash/<group>/`
and removing graph rows. The group directory is flat: each file waits under a
number, and the journal's `slots` list says where it came from, so the trash
never stacks a second copy of the case tree under itself. Restore refuses
occupied destinations, then restores the original entity ids, surviving links
and tombstones. An interrupted delete is rolled back or published on the next
case open; an interrupted restore is completed.
Shared thumbnails do not move; they are discarded and queued again
after restore. Purge removes the journal only after its directory is gone, so a
Windows file lock leaves a retryable group instead of orphaned bytes.

## Case bundles

Exports run as `bundle-export` jobs and write atomically to
`<workspace>/.azimut/bundles/`, then stream to the browser as an attachment. The first
ZIP member is `bundle-header.json`; the last is `bundle.json`, which lists every
other member with its size and SHA-256. The database is copied consistently,
its trash and unfinished jobs are removed, and it is vacuumed before packaging.
`.trash/`, `media/.thumbs/` and `media/.dl/` never travel.
Export also reserves filesystem headroom before writing its temporary output.

Bundle format 2 carries the complete case under a `case/` member prefix:
`case/azimut/` for application state and every regular entry beside it for the
analyst's free zone. The prefix keeps the bundle metadata outside that free
zone, so even analyst files called `bundle.json` or `bundle-header.json` round
trip. A case-root name that case-insensitively collides with `azimut/` is
refused, as are symbolic links on both export and import. There is no fixed size
ceiling: exports and imports use current free space plus a safety reserve, and
the import dialog warns when the temporary requirement reaches 10 GiB.

Password protection encrypts the complete ZIP in 1 MiB AES-256-GCM chunks. The
key comes from scrypt (`n=2^15`, `r=8`, `p=1`), and only the envelope parameters
remain clear. Passwords live in a process-memory map keyed by job id, never in
the durable payload.

Import pre-flights format and database versions before creating a destination.
The browser file picker uploads to `<workspace>/.azimut/bundles/.imports/`; rejected and
cancelled uploads are removed immediately, completed imports remove their source,
and abandoned uploads expire after 24 hours.
It verifies unique safe member names, declared and actual byte counts, archive
member count, and rejects symlinks. It extracts only the manifest allowlist
after each hash matches. There is no small fixed case-size cap: preview and
import compare the required temporary space with current filesystem capacity,
keep a safety reserve, and warn for imports above 10 GiB. Work is staged under
`<workspace>/<id>.incoming/`; the existing shell and completed staging directory are
swapped by rename for Windows compatibility. Every import creates a new case and
records `origin_case_id` plus `imported_at` in database metadata.
Entities and links keep their original ids, provenance and confirmation status.

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
  comma-separated `type` set, `status`, `q` over label/type/folder/notes, and
  folder (`unfiled=true` or an exact path, with optional descendants). The cursor keys on `rowid`, so a
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
pagination (a relations/graph view), and ranked full-text search (gated on
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

The media listing and the satellite capture listing both tag each item with a
`thumb_state` (`ready`, `queued`,
`running`, `failed`, or `none`). The Media Library renders the image when ready
(lazy-loaded, async-decoded, with an `onerror` fallback to the type icon that
reports once and does not retry per render), a "Generating…" placeholder while
queued, and a retry affordance on failure. `POST
/api/cases/{id}/media/thumbnails/regenerate` re-queues one item (the per-card
retry) or every missing/failed one; the grid polls the listing while anything is
pending, and stops on its own once nothing is.

Every picker cell shows the cached thumbnail or a placeholder, never the
original: a proof panel picker rendering full-size captures in 150px cells was
the slowest surface in the app. The proof pickers poll the listing while
anything is pending, like the grid does.

A saved proof's export is thumbnailed through the same cache: `POST
/cases/{id}/proofs` renders one from the bytes it just wrote and records it in
the spec, and `GET /cases/{id}/proofs` backfills any proof that has none (saved
before this existed, or evicted) at the cost of one hash of the export. The open
dialog falls back to the export itself when no thumbnail could be produced.
Proof thumbnails count as referenced by `repair`, which otherwise sweeps
anything no media sidecar points at.

`GET /files/{case}/{path}` serves with an ETag and answers a matching
`If-None-Match` with a 304, so reopening a picker revalidates instead of
refetching. Thumbnail URLs fold in the content hash and the generator version,
so they can never change meaning and are served `immutable` — the browser stops
asking for them at all.

The Media Library and Files browse media through `GET
/api/cases/{id}/media/page`, a bounded SQLite query with `q`, `kind`,
source-derived `category`, `folder`, `sort`, `limit` and `cursor`. It returns
`total` plus full-result kind, folder and category facets. Large cases load one
page and search without opening or sorting every sidecar. Files requests
thumbnail, kind and size metadata only for paths it can render through `POST
/api/cases/{id}/media/metadata`. The unbounded `GET /api/cases/{id}/media`
stays for consumers that genuinely need the whole index, such as composer
pickers, satellite crops and derivation traces.

The Map's Saved panel opens on `GET /api/cases/{id}/satellite/index`: one compact
row per place, capture and filed screenshot — id, kind, title, coordinates,
geography, thumbnail, provider, dates, notes, and nothing else. The tree, the
search modal and the map overlay all read that one response, so hundreds of saved
items cost tens of KB instead of every capture's full media row and full-size
image. Rows come newest first on a single normalised timestamp, and the endpoint
makes no network call. Geography rides on the entity's `attrs.geo`
(`ok`/`nocoords`/`nocountry`/`failed`); continent is never stored, it is derived
from the country code at read time (`engine/continents.py`), so correcting that
table repairs existing cases with no migration. Countries that span two
continents (Russia, Kazakhstan, Turkey) are split by the point's own
coordinates, so a Vladivostok capture files under Asia. Saving resolves the country
inline, bounded by a short timeout; `POST /api/cases/{id}/satellite/locate?limit=N`
backfills up to 25 at a time, waiting ~1.1s between lookups for Nominatim's rate
limit, and reports `remaining` so the client can loop. Progress is the stored
geography itself, which makes the pass resumable and idempotent.

## Filesystem and database consistency

SQLite cannot atomically commit a filesystem rename, so file-backed operations are
recoverable. Creation produces a file under a unique temp name, validates it,
renames it to its final path, then registers it in a short transaction. Deletion
removes the file and sidecar, then settles the database. Thumbnail generation
follows the same temp-then-rename discipline. The rollback journal means a copied
closed case is always complete.

## Performance

The deterministic large-case fixture (`tests/bigcase.py`) builds entities,
links, media, nested folders, notes, suggestions, unknown types, mixed thumbnail
states, proof/post/Inspect artifacts, missing files and tombstones. Storage and
release tests open that fixture through the SQLite migration boundary. The same
arguments produce byte-identical graph rows.

Interaction budgets on the reference machine:

| Operation | Target |
|---|---:|
| Open case and render the first useful page, cold | 2 seconds or less |
| Open case, warm filesystem cache | 750 ms or less |
| Return a warm filtered/search page | 300 ms or less |
| Update one metadata record | 200 ms or less |
| Mounted catalog rows/cards | 300 or fewer |
| Default CPU-heavy background jobs | 1 at a time |

These are interaction budgets, not release claims. Shared CI hardware varies,
so the automated suites enforce bounded queries, result sizes, and mounted-row
limits instead of machine-specific timings.

## How it is verified

- **Graph contract** (`tests/test_repository.py`): entity/link/folder CRUD,
  dedupe, `sync_links` id preservation, folder subtree removal, cursor paging and
  summaries, the derivation closure, and the durable job queue (idempotent
  enqueue, claim, retry-then-fail, recover, prune) held against `Case`
  (SQLite-backed).
- **Store specifics** (`tests/test_sqlite_backend.py`): create/open, newer-schema
  refusal, foreign keys, rollback, the in-place schema upgrade through every
  migration, keyset paging, media browse search/facets, and the atomic converter
  (roundtrip, dangling-link report, failure leaves no db, large-case integrity).
- **Migration** (`tests/test_migrations.py`): legacy json → sqlite on open, backup
  recoverability, a failed activation leaving the json case usable, forward-compat
  refusal.
- **Thumbnails and jobs** (`tests/test_thumbnails.py`, `tests/test_media_api.py`):
  inline vs queued, atomic generation with no partial/temp on failure, content-key
  by generator version, drain + retry-then-fail, cancel on missing media, LRU
  budget eviction, orphan/temp repair, shared-thumbnail delete safety, the
  background worker, startup recovery, and the `thumb_state` + regenerate API.
- **File serving** (`tests/test_files_api.py`): revalidation to 304, immutable
  thumbnails, and an edited original invalidating its own ETag.
- **Proof exports** (`tests/test_proofs_api.py`): a thumbnail on save, the
  listing backfilling an older proof and recording it, the fallback when none
  can be rendered, and `repair` leaving proof thumbnails alone.
- **Release gate** (`tests/test_release_gate.py`): a legacy case migrates and every
  workflow answers, a closed-case folder copy opens identically, a large migrated
  case opens through bounded queries, and the frozen-binary packaging constraints
  hold.
- **Frontend** (vitest + svelte-check + the production build): first-page paging,
  complete server search, full-result media facets, request cancellation on case
  switch, scoped metadata loading and thumbnail placeholder/failure/retry markup.

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
