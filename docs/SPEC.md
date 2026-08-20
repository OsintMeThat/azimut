# Azimut product overview

Status: **spec v0.3** (2026-08-03). Read in order: Done → Roadmap → Loose ideas.
Implementation detail belongs in code and tests; see
[IMAGERY_PROVIDERS.md](IMAGERY_PROVIDERS.md), [UI.md](UI.md),
[ONTOLOGY.md](ONTOLOGY.md) and
[STORAGE_AND_PERFORMANCE.md](STORAGE_AND_PERFORMANCE.md).

---

## 1. Product

Azimut is a local OSINT workspace. It keeps source media, geolocation work,
proofs, notes and exports in one portable case folder.

## 2. Principles

1. **Local-first.** No account, telemetry or upload. Network access follows a
   network-dependent action, except for the optional startup release check.
2. **Portable cases.** Files hold media, notes and proofs; per-case SQLite holds
   the graph. A closed case folder is complete and can be copied as-is.
3. **Focused tools.** One tab performs one task and also works in a promotable
   scratch case.
4. **Orchestration.** Specialized services stay external; selected results enter
   the case with provenance.
5. **Analyst control.** Tools may suggest entities or links, but only an analyst
   action confirms them.
6. **Auditable output.** Artifacts record how they were produced and label hints.
7. **Free core.** Local computation and keyless services cover core workflows;
   user-supplied keys add optional providers.
8. **English interface.**

Key constraints:

- **Legal-only imagery.** Built-in providers are Esri, OSM, OpenTopoMap and
  Sentinel-2. Keyed providers need the user's own key.
  Unofficial key-less endpoints of keyed services (`mt1.google.com`) are never
  shipped. Custom XYZ templates stay supported.
- **Two-way delete/edit sync.** An artifact and its sidebar entity are one thing;
  deleting either removes the other. One capture ⇄ one `capture` entity.

## 3. The case workspace

The workspace is `~/Azimut` unless it was moved: `AZIMUT_HOME` wins, then a
one-line pointer file at the platform's configuration location, then the
default. A directory per investigation (`~/Azimut/<case>/` by default):

```
README.txt     # which half of the folder is whose
azimut/        # everything Azimut owns; the rest of the folder is yours
  case.json    # small manifest: name, dates, storage format + schema
  notes.md     # free-form case notes (markdown)
  notes/       # note bodies, named after their title, filed as in the notebook
  sheets/      # case sheets as plain CSV; .meta/ holds the grid's own state
  media/       # source + captured + extracted media; .meta/ holds the sidecars
  proofs/      # exported PNGs; .meta/ holds the specs and pasted images
  exports/     # notes as PDF, analysis plates, and yours to fill
  .data/       # case.db: authoritative SQLite graph
  .drafts/     # post drafts
  .inspect/    # saved Inspect session specs
  .search/     # saved Grid Search state
  .trash/      # recoverable artifact payloads, in numbered slots
```

Tools use `CaseRepository` for structured state. Media, notes and proofs remain
files. Legacy JSON graphs migrate to SQLite on open with a retained backup.
One-shot work uses the same code path in a promotable scratch case. Exported
case bundles live under the workspace's hidden `.azimut/` directory.
App-wide settings, scratch cases, caches and runtime tools also stay under
`.azimut/`, so the visible workspace root contains only permanent cases.

## 4. Data model

The entity/link schema has existed since v1. Full vocabulary lives in
[ONTOLOGY.md](ONTOLOGY.md).

- **Entity types** (extensible) sit in one of eight **families**. Relations start
  from families and narrow endpoints where a verb is type-specific:

  | Family | Types |
  |---|---|
  | actor | person, organization |
  | asset | vehicle, vessel, aircraft, structure |
  | class | equipment-type |
  | identifier | account, email, phone, domain, ip, network |
  | collected | media, capture |
  | document | proof, post, note, inspect-session, bookmark |
  | place | place |
  | claim | claim |

- **Links**: typed directed edges (owns, part-of, member-of, associated-with, posted,
  appears-in, sited-at, instance-of, in-network, located-at, depicts, same-image-as,
  about, at, cites, contradicts, …) plus free-typed labels.
- **Provenance on everything**: which tool/action, source, when and review status
  (`confirmed` by analyst vs `suggested` by a tool).
- **Assessment stays separate**: a Claim carries its confidence; a ratable ordinary
  relation may carry its own ordinal; a source carries Admiralty reliability A–E.

Tools suggest entities and links; the analyst reviews them. Relations, Mentions,
Claims, lineage, the Board, the graph and configurable saved Timeline readings are
shipped.

---

## 5. Done

### v1 Proof Studio (shipped as GitHub `v0.1.0+`)

The first complete workflow: collect media → annotate the match → prepare the
proof for publication.

| Tool | What it does |
|------|--------------|
| ✅ **Media Library & Inspect** | Imports or downloads case media with metadata, provenance and hashes, then reviews images and video through saved editing sessions. |
| ✅ **Satellite** | Saves places and attributed map captures from free or optional keyed imagery, including dated Sentinel-2 passes and usage controls. |
| ✅ **Geo Proof** | Composes annotated panels, files their coordinates as places and exports an editable PNG proof. |
| ✅ **Geo Report** | Prepares sourced proof threads and saved drafts without posting automatically. |
| ✅ **Case navigation** | Searches, groups and files case work through the sidebar, Saved views, folders, notes and synchronized deletion. |
| ✅ **Capture extension** | Files user-requested screenshots with their source details, saves map points and bookmarks pages. |
| ✅ **Distribution** | Ships the browser UI, hardened local launcher, locked cross-platform builds, ffmpeg and browser interaction tests. |

### v2 GEOINT suite (shipped as GitHub `v0.2.0+`)

| Tool | What it does |
|------|--------------|
| ✅ **Coordinates & sky** | Converts coordinates and reads sun, moon, twilight and local time for a saved point on charts or the map. |
| ✅ **Research helpers** | Prepares media for keyless reverse search and saves keyboard-reviewed AOI grids. |
| ✅ **Reports & templates** | Stores reusable proof and post structures, then prepares sourced Markdown for X, Bluesky or Mastodon. |
| ✅ **Case Notebook** | Edits linked Markdown notes with local media, Mermaid diagrams, PDF output and remembered export folders. |
| ✅ **Media at scale** | Handles login-gated downloads from a gate read in the site's own words, reusing a session named once and keeping the first attempt cookie-less, with bounded search, searchable pickers, local metadata enrichment and GPS handoff to the map. |
| ✅ **Storage & recovery** | Uses per-case SQLite and durable jobs, with whole-case bundles, Trash and portable settings backups. |
| ✅ **Case utilities** | Opens case folders, reports scrubbed diagnostics, keeps filenames in sync and offers explicit Doctor repairs. |
| ✅ **Evidence on the map** | Places proofs and derived media through their evidence chain, with stated point uncertainty and traced footprints. |
| ✅ **Ontology connections** | Keeps Relations, Mentions, Claim connectors and artifact lineage separate under one validated verb registry. |
| ✅ **Board & entities** | Provides the sortable Case Board, shared Details, typed creation, primary entity photos and a ticked selection deleted as one recoverable act. |
| ✅ **Case graph** | Draws registry-backed lenses with clustered nodes, readable edges, previews and an explicit view budget. |
| ✅ **Working the graph** | Expands, folds, hides, searches and pins nodes per lens, with undo and no case mutation. |
| ✅ **Graph evidence** | Folds sources onto their edges and exposes derivation, support, source and account counts. |
| ✅ **Shared analysis views** | Shares one filter and saved-view family between Board and Graph while Timeline keeps readings built for tracks. |
| ✅ **Claim assessment** | Keeps statement confidence, relation confidence and source reliability separate, with explicit support and contradiction links. |
| ✅ **Structured findings** | Records associations, duplicate identifiers, asset condition, equipment models and statement totals without inventing missing values. |
| ✅ **Temporal Claims** | Dates a Claim with guided point, timestamp or interval input and files its subjects, places and evidence atomically. |
| ✅ **Case Timeline** | Aligns dated statements and media on a windowed UTC axis with uncertainty, density, direct edits and Undated work. |
| ✅ **Timeline readings** | Builds coloured tracks from presets or Search+, then saves a changing Live view or a fixed Snapshot. |
| ✅ **Timeline clocks & comparison** | Reads the axis in UTC or a chosen civil zone, adds daylight context and compares exact or uncertain entries. |
| ✅ **Shared fact time** | Passes one fact-time window between Timeline, Board, Graph and a session-only Map layer without mixing in filing dates. |
| ✅ **Workspace portability** | Moves or adopts a workspace safely, recovers hand-added cases and prevents two live instances from sharing it silently. |
| ✅ **Updates & paste** | Reports available app, downloader and extension updates, then files supported clipboard content from the main case surfaces. |
| ✅ **Saved view management** | Renames a live or frozen reading in its row and orders each family's list by name, edit or surface, with the surface and last write on show. |
| ✅ **Analysis view export** | Writes the Graph or the Timeline out as a vector plate carrying its lens, question, window, clock and legend, or copies it as an image. |
| ✅ **Case Sheet** | Opens and builds case CSVs in a plain grid, with keyed rows, two sort keys, filters, row colour, a pinned reference row, clipboard both ways, bulk fill, undo, a row read down a panel, and cells that point at case entities. |
| ✅ **Working a sheet** | Sorts, filters, inserts, duplicates, renames, merges, pins, hides and deletes from the heading's own menu, and rewrites an imported column through six passes that say first how many cells they would touch. |
| ✅ **Two writers on one file** | Notices a CSV changed on disk when the window comes back, reads it as a diff, and confirms the reload or the overwrite rather than choosing for the analyst. |
| ✅ **Columns that know what they hold** | Types a column in the sidecar as a state, a list, a yes/no, a number, a point, a date or a picture, and lets the sort, the filters, the vocabulary, the map, the Timeline, the progress and the link check read it. |
| ✅ **A family of sheets** | Files a workbook one sheet per tab, forks a sheet with its rows or with only its columns, and moves ticked rows to another sheet under a column mapping, with the whole move undone from its toast. |
| ✅ **A sheet into the case, both ways** | Promotes a declared sheet into entities, places, bookmarks, vocabularies, row edges and dated Claims in one transaction, read as a plan first, and builds a worklist back out of what the case holds. |
| ✅ **A geolocation index into proofs** | Builds one proof per row out of two columns of addresses and a column of coordinates, as a stoppable job that is atomic per row and safe to press twice. |
| ✅ **Imported proofs** | Turns a published post into a composed proof: every picture a panel, its text read for a position, the footage it points at fetched, and nothing filed before the preview is approved. |
| ✅ **Where an imported file came from** | States one origin for a whole import, offers it to a batch that landed without one, and corrects any file later from Details without writing over what a download recorded. |
| ✅ **A reading handed over** | Writes the rows on screen out as a CSV into the folder this case files sheets in, or copies them as a Markdown table carrying the case, the sheet, the filter, the sort, the count and the hour. |


---

## 6. Roadmap

Each version delivers one complete daily workflow. Firm ideas move here from
§7. New tools become tabs or modes in an existing workspace (see
[UI.md](UI.md)). Releases ship as GitHub `v0.x` tags.

### v2: still to finish (next `v0.2.x`)

Toward v2: split Satellite.svelte into `lib/` modules, before the map engine
changes under it.

### v3: GEOINT expansion

| Tool | What it does |
|------|--------------|
| **Map engine (MapLibre)** | Replaces Leaflet with MapLibre GL at 2D parity: same providers, same captures, and the capture tests still verify the pixels. Ships before the 3D map, which builds on it. |
| **3D map** | Pitch, public DEM terrain and extruded OSM buildings on the MapLibre map. An oblique capture records its pitch beside the bearing, so the view can be reproduced. |
| **Camera Resection (GCP)** | Marks matching points photo↔map, then solves camera position, viewing azimuth and rough FOV (OpenCV `solvePnP`) and saves the match as evidence. Its photo canvas and pixel↔angle camera frame are built for two callers: Sky Clock fills the same frame by hand. |
| **Capture scale and north** | Preference-controlled scale bar, north arrow and graticule on app and extension captures. Follows the map engine, which redraws what a capture is made of. |
| **Footprint tracing** | Draws a place's uncertainty as the shape it really is, for a quay, a treeline or an L-shaped block the circle describes badly. The field, its validation and its drawing already ship; only the gesture is missing, and it follows the map engine rather than being written twice. |
| **Satellite Compare** | Same coords across providers (Esri / Sentinel-2 date slider / Bing / keyed), synced pan/zoom. Copernicus easy link. |
| **Image Compare** | Overlay two images with opacity, swipe and pixel diff. Assist satellite-to-screen alignment without presenting a verdict. |
| **Metadata follow-up** | Explains which common image/video fields were stripped and proposes events from capture times. |
| **Edit Provenance** | Reads a rendered video's own edit history: which source clips it was cut from, in what order, and the GPS, dates and cameras those clips still carry. |
| **Sky sessions** | Saves a sun or moon lookup as a case artifact: the point, the date and the time, never the numbers they produce. It reopens where it was left, a proof can show its reading, and a statement can cite it. |
| **Grid sessions in the graph** | Brings the saved AOI grids into the case as entities, adopting the specs already on disk. Grid Search is the last saved tool state living outside the graph, so today nothing can say "this sweep is how I found it". |
| **Sky Clock** | Marks a shadow, the sun or the moon in an image or a video frame, with the horizon and north giving the angles, then renders the year as a day × hour heatmap of the slots that fit. A visible moon also carries phase and bright-limb angle, which usually cuts a year down to a few instants. |
| **Case KMZ** | One self-contained file per case: a pin per place, carrying the notes and proof images it is linked to, opened in Google Earth. Frozen rather than live, because only the web Earth remains and it follows no network link. |
| **Imagery Wayback** | Esri World Imagery archive as a date slider: one view across every published release, key-less. |
| **Event layers** | Date-stamped overlays that support or contradict an event: NASA FIRMS thermal hotspots, archived weather and METAR. |
| **Shot contact sheet** | Splits a video into shots (ffmpeg scene detection) and picks frames from a clickable grid of timecodes. |
| **OCR** | Reads signs and plates on import (tesseract, a native binary rather than a wheel), and detects script and language. |
| **Audio Transcript** | Transcribe and translate speech offline; flag acoustic context such as bells, adhan, aircraft or language. |
| **Ground Imagery** | Ground-level photos: Panoramax/Mapillary/KartaView key-less first; Street View easy link, optional keyed in-app view. |
| **Panorama** | Stitch a video window / frame set. Auto-stitch already in Inspect; still to do: sample a video window directly, seam blending. |
| **Proof annotation** | Grow the Geo Proof toolbox: shape fill + dashed strokes, numbered markers, a redaction/blur box; a document-level free layer so shapes cross panels and reach the margins; callout / zoom insets. |
| **Command palette** | Ctrl+K reaches a tool, a case or an artifact. |
| **Help and tips** | A mark the analyst clicks for the open tool's own guide: what it is for, the controls whose icon does not say it, and its shortcuts. Clicking an entry points at the real button. One panel, one entry per tool. |

Edit Provenance rests on three facts about Adobe renders, kept here so the tool
can be rebuilt from the spec alone:

- A Premiere or After Effects export carries an XMP `Ingredients` array: one row
  per source asset, with its original file path, document and instance IDs,
  `From Part` (the range taken from the source) and `To Part` (where it sits in
  the render), counted in ticks of 254,016,000,000 per second.
- `Pantry` blocks embed each source asset's own XMP — GPS, capture date, camera,
  lens — and, when that asset was itself a sequence or comp, its own
  `Ingredients`, which project into render time under an assumed linear playback.
- `To Part` values may be elapsed render time, absolute display timecode, or the
  coordinates of a longer sequence the export was cut from; the origin has to be
  detected before anything is drawn.

The result is one track per source file over the render's timecode, with
GPS-tagged clips promotable to places.

Toward v3: GIF maker; curated tool links; full-text case search; clipboard
image/URL capture with provenance; EXIF/GPS import suggestions for place and
time; sun and moon times read against the terrain horizon the 3D map's DEM
supplies, since a ridge ends the day well before the flat horizon does.

### v4: investigation layer

| Tool | What it does |
|------|--------------|
| **Skyline Matching** | Traces a horizon in a photo and compares it against the DEM profile seen from candidate points, in the same azimuth and elevation frame Camera Resection and Sky Clock already use. Terrain-occluded sun times then split candidates a matching horizon leaves tied. |
| **Map Board (MyMaps-style)** | Editable case map: custom pins + notes/links, shapes, layers; import/export KML/KMZ/GeoJSON; pins bind to `place`. |
| **Evidence Locker** | Track SHA-256, timestamps, source and notes; archive with Wayback; export `evidence.jsonl` under a hash-chained manifest, so any later edit to an exported file is detectable. |
| **Report Builder** | Assemble proofs/maps/timeline/entities/notes into PDF or one self-contained HTML file with its media embedded, readable offline. |
| **Case Sync (Git)** | Push a case to a private or public Git remote, pull it back, and diff two revisions, so two analysts can work the same case. |

Toward v4: archive-on-download and a Wayback CDX snapshot timeline with diff; web-page save
extension; provenance stamp on exports (short hash, optionally visible) that
re-identifies a shared PNG in its case;
Sentinel-2 change detection with an NDVI difference over a date range; source
location pattern-of-life map and timeline; cross-case handle/coordinate/face
search; optional quota-aware X publishing.

### v5: orchestration and advanced

| Tool | What it does |
|------|--------------|
| **Search Orchestrator** | Run username/alias/email across services, analyst selects → entities. Integrations, not clones. |
| **OSM Query (Overpass)** | Feature search from a form, and a described pattern ("filling station, roundabout, railway within 300 m") turned into candidates on the map; clicking a point looks it up in OSM, Wikidata and geolocated Commons photos. No Overpass QL. |
| **Viewshed / Line of Sight** | What terrain is visible from a point (public DEM tiles). |
| **Camera Track (video SfM)** | Solves a moving camera's path from a video: frames sampled from a window, position and viewing azimuth per keyframe, and a sparse point cloud. Reports insufficient parallax instead of guessing. Bundles a native SfM binary (COLMAP/GLOMAP), CPU-capable. |
| **Vessel and Aircraft Tracks** | Historic ADS-B and AIS tracks on the map for a date, plus a watchlist that follows chosen callsigns or MMSIs. |
| **Map Measures** | Distance, bearing/azimuth, area, FOV cone; includes measure-on-imagery, and its bearing layer absorbs the v2 sun/moon arcs. |
| **Déjà Vu** | Perceptual-hash index flags recycled footage (local first; community index later). |
| **Manipulation Hints** | Add JPEG quantization, noise and AI-media hints alongside Inspect's ELA. |
| **Channel Monitor** | Watch Telegram channels, auto-archive media, queue for geolocation (rate limits, ToS care). |

Camera Track rests on three facts, kept here so the tool can be scoped from the
spec alone:

- Parallax, not motion, is the requirement: a pan from a fixed point yields
  nothing, and rolling shutter or a re-encoded low bitrate breaks matching. The
  tool fails early and says why.
- SfM output is scale-free. Metres come only from an injected reference: the GCP
  camera pose from Camera Resection, or a known length. Every distance stays a
  labelled estimate.
- Photorealistic rendering stays external. The case exports a COLMAP-format
  folder for a WebGPU gaussian-splatting trainer, which needs no CUDA and so runs
  on all three shipped platforms, and reimports the result as an artifact with
  provenance.

Toward v5: real-world measurement from a resected photo or a solved camera track
and its GCP camera pose; a gaussian-splat round trip for a solved camera track;
satellite-pass search from public TLEs; 3D satellite capture; Google
Photorealistic 3D Tiles on the user's own key; non-destructive identity resolution
for duplicate entities returned by orchestrated searches.

## 7. Loose ideas

No version yet. Promote an idea when its workflow is clear; delete it when it
stops making sense.

- **Media in the analyst's half:** a button that looks for media beside `azimut/` and offers to bring them into the case, rather than waiting for them to be moved into `media/` by hand.
- **Count a statement's independence by origin, not by wrapper:** three collages made from one video are three sources today, and are arguably one. The graph already answers this for a place; changing it for a statement changes a published number.
- **Free-form montage editor:** consider only if it stays distinct from Geo Proof and Inspect collage.
- **In-app OSINT assistant:** local chat and vision suggestions for analyst confirmation, with no cloud or API key by default.
- **Geographic playback:** step through dated case items on the map instead of showing one fixed Timeline window.

## 8. Explicit non-goals

- No cloud, accounts, hosted service, or telemetry.
- No automated geolocation verdict; Azimut files facts for the analyst.
- No rebuilding specialized OSINT services; Azimut orchestrates them.
- No block-evasion scraping. User session cookies are in scope; third-party
  downloader proxies are not because they re-encode media and expose targets.
- No auto-posting by default. An optional, opt-in X/Twitter API key (Settings,
  with quota shown) may enable Geo Report publishing. Core features never
  require a paid API.

## 9. Architecture

- **Backend**: Python 3.11+, FastAPI on `localhost`; current processing (ffmpeg,
  yt-dlp, gallery-dl, OpenCV) runs server-side.
- **Frontend**: Svelte + Leaflet (→ MapLibre) + Konva/canvas, served by the
  backend, opened in the default browser. Rail = workspaces in pipeline order,
  tools are tabs inside them (see [UI.md](UI.md)).
- **Settings and secrets:** in-app tabs group general preferences, publishing,
  imagery, templates, the capture extension, storage and system tools; keys
  stored locally and never bundled into a shared case, monthly usage counters,
  backup export/import, opt-out "new release is live" pop-up on load (per-version
  "don't show again"). Display preferences affect presentation only; artifacts keep
  decimal degrees + metres on disk.
- **Distribution:** `pip install azimut` plus PyInstaller single-file binaries
  for Windows x86_64, Linux x86_64 and Apple Silicon macOS. Binaries bundle a
  static ffmpeg/ffprobe; pip installs still want ffmpeg on `PATH`. Intel macOS
  uses the Python package.
- **Dependencies:** ranges in `pyproject.toml`, exact pins in `uv.lock`; yt-dlp
  + gallery-dl unbounded on purpose; scraper self-update keeps an old binary useful.
- **Storage:** per-case SQLite `case.db` is the authoritative graph (files for
  media/notes/proofs); deleted artifacts wait in `.trash/`, and portable case
  bundles carry a cleaned database plus declared files under a SHA-256 manifest.
  Legacy `case.json` cases migrate on open; case open and lists use bounded,
  cursor-paged queries; thumbnails and background work run through a durable,
  recoverable per-case job queue drained by one worker. Details in
  [STORAGE_AND_PERFORMANCE.md](STORAGE_AND_PERFORMANCE.md).
- **Security posture** (single-user localhost): `127.0.0.1` bind + Host/Origin
  guard (DNS rebinding), 0600/0700 perms, hard 100 MP Pillow limit, content-hashed
  names for images pasted into a proof (no client-chosen path), token-gated
  ingest island for the extension. A case id and an artifact name each address
  one directory entry, checked against POSIX *and* Windows path rules so the
  separator only one of them honours cannot walk out of the workspace. The workspace pointer is the one file written
  outside the workspace, 0600 and holding a path; deleting the copy a move set
  aside acts on this process's own memory, never on a path from the request.
  Accepted risks recorded here: cleartext keys over
  localhost, the hash-verified scraper updater, tile/media URL fetches (SSRF
  only matters if the localhost assumption breaks), and a download that fails
  saying only that the content is unavailable being retried with the stored
  browser session, so a merely deleted post gets the analyst's cookies — kept
  because a hundred-row press cannot stop on a question and the first attempt is
  always cookie-less. A sheet's link check refuses a literal loopback, private or
  link-local address on the first hop and on every redirect; a hostname that
  resolves to one is not looked up to find out, and what such a hop could learn is
  "this port answered" and never a body. An imported workbook is bounded on its
  compressed bytes and on the size its own directory declares once unzipped. The map's search bar answers from
  a bundled gazetteer and never reaches out on a keystroke; its geocoder layer
  waits for a pause, and a request the one-per-second pace cannot take is dropped
  rather than queued. The startup update check is
  the one on-mount network call: opt-out, and read-only against GitHub's
  releases feed plus PyPI's JSON for the two downloaders, both governed by the
  same switch. Release notes are rendered through the Notebook's
  DOMPurify-sanitized Markdown renderer rather than as raw HTML. The capture
  extension is compared locally, so it is answered with the switch off. Remote images embedded in a
  Notebook note contact their host whenever the preview opens; Notebook warns
  about that behavior and local Case media avoids it. Notebook diagrams are the
  one markup DOMPurify does not clear: Mermaid draws its SVG into the preview
  after sanitizing, under its own `strict` level, which escapes labels and drops
  click handlers. Two routes take a picture drawn in the browser back: the note
  PDF export, whose request, diagrams and decoded total are bounded before
  rendering, every diagram read as an image and the note's own text re-read from
  disk rather than trusted from the request; and the analysis plate, bounded the
  same way and inspected before it is written, since a plate lands where documents
  are opened — it must start as an SVG and carry no script, event handler,
  embedded document or reference leaving the file. Case imports extract only unique, non-symlink members declared
  by the manifest and matching its SHA-256. Password-protected bundles seal the
  complete ZIP with chunked AES-256-GCM and a scrypt-derived key; filenames stay
  encrypted and the password is never persisted in a job. Import temporarily
  stages a decrypted ZIP inside the incoming case directory. Imports validate
  declared and actual sizes, reserve filesystem headroom and warn above 10 GiB;
  downloads and generated files still have no app quota.

## 10. Open questions

- Source reliability sits on the `bookmark` or the `account` cited. Reopen it the day
  a source is neither: a paper document, a testimony.
- Déjà Vu community index: needs infrastructure and moderation; out of scope
  until v5.
- Name/handle availability: GitHub org/repo `azimut`, x.com handle, domain.
