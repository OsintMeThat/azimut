# Azimut product overview

Status: **spec v0.3** (2026-07-18). Read in order: Done → Roadmap → Loose ideas.
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

A directory per investigation (`~/Azimut/cases/<case>/` by default):

```
case.json      # small manifest: name, dates, storage format + schema
case.db        # authoritative SQLite graph: entities, links, folders
notes.md       # free-form case notes (markdown)
notes/         # filed note bodies (Markdown)
media/         # source + captured + extracted media, with metadata + sha256
proofs/        # composed proofs: exported PNGs + editable JSON specs
               #   <name>.assets/ holds images pasted into that proof only
exports/       # post drafts, reports, shared bundles
inspect/       # saved Inspect session specs
```

Tools use `CaseRepository` for structured state. Media, notes and proofs remain
files. Legacy JSON graphs migrate to SQLite on open with a retained backup.
One-shot work uses the same code path in a promotable scratch case.

## 4. Data model

The entity/link schema has existed since v1. Full vocabulary lives in
[ONTOLOGY.md](ONTOLOGY.md).

- **Entity types** (extensible): person, organization, alias/username, account,
  email, phone, domain, ip, vehicle, place, event, media, proof.
- **Links**: typed directed edges (owns, appears-in, located-at, same-as, posted,
  mentions, …) plus free-typed labels.
- **Provenance on everything**: which tool/action, source, when, confidence
  (`confirmed` by analyst vs `suggested` by a tool).

Tools suggest entities and links; analyst confirmation adds them to the graph.
Relations, graph, map and timeline views are planned for v4.

---

## 5. Done

### v1 Proof Studio (shipped as GitHub `v0.1.0+`)

The first complete workflow: collect media → annotate the match → prepare the
proof for publication.

| Tool | What it does |
|------|--------------|
| ✅ **Media Library** | Imports or downloads case media with metadata, SHA-256, notes, provenance and multi-attachment selection. |
| ✅ **Inspect** | Reviews images and video, including saved orientation (±90°/±180°), frame selection, adjustments, crops, collages, auto-stitch, ELA hints and sessions. |
| ✅ **Satellite** | Saves places and attributed map captures with provider, date, rotation, measure and reference tools. |
| ✅ **Saved work navigation** | Groups a case's places, captures and filed screenshots by continent/country/region (labelled in English and the local language) or by My-work folder, searchable in either spelling with previews and shown on the map. |
| ✅ **Geo Proof** | Composes templated grid or free-layout panels with annotations, coloured frames and pasted overlays that stay out of the case, and exports a PNG with an editable spec. |
| ✅ **Geo Report** | Prepares sourced proof threads and saved drafts without posting automatically. |
| ✅ **Case sidebar** | Searches and filters the case, manages notes, suggestions, folders, multi-row filing, a details drawer and synchronized artifact deletion. |
| ✅ **Imagery providers** | Supports Esri, OSM, OpenTopoMap, Sentinel-2 and optional Mapbox/Google with usage controls. |
| ✅ **Capture extension** | Files user-initiated map screenshots with URL metadata, attribution and provenance; also saves a map's point as a place, or any page as a bookmark. |
| ✅ **Distribution** | Bundles the browser UI, launcher, cross-platform binaries, ffmpeg, locked builds and server hardening. |

### v2 GEOINT suite (shipped as GitHub `v0.2.0+`)

| Tool | What it does |
|------|--------------|
| ✅ **Coordinates** | Converts common coordinate formats, copies results and opens map or geocoding links. |
| ✅ **Reverse Search** | Prepares image or video frames for keyless reverse-image services without uploading automatically. |
| ✅ **Grid Search** | Saves editable AOI grids with keyboard review states and place promotion. |
| ✅ **Templates** | Stores reusable proof styles and post-thread structures at workspace level. |
| ✅ **Geo Report outputs** | Targets X, Bluesky or Mastodon and saves structured Markdown notes with evidence links. |
| ✅ **Case Notebook** | Edits tabbed Markdown notes with local media, entity links, broken-reference markers and PDF output. |
| ✅ **Notebook diagrams** | Draws ```mermaid fences in the preview and the PDF, loading the library only when a note holds one. |
| ✅ **Canvas tests** | Exercises Leaflet and Konva interactions in Chromium and Firefox. |
| ✅ **Storage platform** | Uses per-case SQLite, bounded catalog queries and a durable one-worker job queue. |
| ✅ **Gated downloads** | Fetches login-walled media by borrowing a browser session or cookies.txt, cookie-less by default and prompted only on a wall. |
| ✅ **Find at scale** | Bounded, paged loading with a shared search box and sort across the Media Library and Files, plus case-name search in the switcher. |
| ✅ **Searchable pickers** | Pickers in Inspect, Reverse Search, Geo Proof and the Notebook notes menu search past six entries and browse case folders behind the "…". |
| ✅ **Named saves** | Inspect's Save gate names each item or numbers a batch from one base name, carries a shared note, and gives the file on disk the same name; a collage keeps one name across its tab and the gate. |
| ✅ **Named documents** | Inspect, Geo Proof and Geo Report name their work in the tool header ("Inspect 1", "Proof 1", "Post 1" until renamed), save under that name in one click, and move the file when it is renamed. |
| ✅ **Proofs on the map** | A fourth position of the Saved switch places each proof by its own coordinates, then by the captures it composes; `All` marks a worked capture with a dot rather than doubling it. |


---

## 6. Roadmap

Each version delivers one complete daily workflow. Firm ideas move here from
§7. New tools become tabs or modes in an existing workspace (see
[UI.md](UI.md)). Releases ship as GitHub `v0.x` tags.

### v2: still to finish (next `v0.2.x`)

| Tool | What it does |
|------|--------------|
| **Case bundle** | Exports a case to one ZIP (clean SQLite copy, keys excluded) and imports it back. |
| **Trash** | Undoes a delete and holds removed artifacts before they go for good. |
| **Import enrichment** | Queues EXIF/GPS, perceptual hash and OCR on import; results arrive as Suggestions. |
| **EXIF in Media** | Shows parsed GPS in the Media list and turns it into a place in one click. |
| **Case Board / Relations** | Browses, creates and merges entities; typed links; graph view over the schema filled since v1. |
| **Case Sheet** | The same case as a table: a row is an entity, columns are its attributes plus free ones the analyst adds, sorted, filtered and edited in place. Imports a CSV as loose rows that stay out of the graph until promoted, and exports back to CSV or GeoJSON. |
| **Camera Resection (GCP)** | Marks matching points photo↔map, then solves camera position, viewing azimuth and rough FOV (OpenCV `solvePnP`) and saves the match as evidence. |
| **Command palette** | Ctrl+K reaches a tool, a case or an artifact. |
| **Sun and local time** | Local time, sunrise/sunset and solar azimuth for a point and date, in Coordinates. |
| **Capture scale and north** | Preference-controlled scale bar, north arrow and graticule on app and extension captures. |
| **Report an issue** | Opens a pre-filled GitHub issue with version, OS and recent log lines. |

### v3: GEOINT expansion

| Tool | What it does |
|------|--------------|
| **Satellite Compare** | Same coords across providers (Esri / Sentinel-2 date slider / Bing / keyed), synced pan/zoom. Copernicus easy link. |
| **Image Compare** | Overlay two images with opacity, swipe and pixel diff. Assist satellite-to-screen alignment without presenting a verdict. |
| **EXIF & Metadata** | GPS/timestamps/device/codecs parsed locally + a "what was stripped" hint; suggests place/event. |
| **Edit Provenance** | Reads a rendered video's own edit history: which source clips it was cut from, in what order, and the GPS, dates and cameras those clips still carry. |
| **Shadow Clock** | Mark a shadow to estimate possible capture times, and render the year as a day × hour heatmap of the slots that fit. |
| **Imagery Wayback** | Esri World Imagery archive as a date slider: one view across every published release, key-less. |
| **Event layers** | Date-stamped overlays that support or contradict an event: NASA FIRMS thermal hotspots, archived weather and METAR. |
| **Shot contact sheet** | Splits a video into shots (ffmpeg scene detection) and picks frames from a clickable grid of timecodes. |
| **OCR** | Read signs/plates (tesseract), detect script/language. |
| **Audio Transcript** | Transcribe and translate speech offline; flag acoustic context such as bells, adhan, aircraft or language. |
| **Ground Imagery** | Ground-level photos: Panoramax/Mapillary/KartaView key-less first; Street View easy link, optional keyed in-app view. |
| **Panorama** | Stitch a video window / frame set. Auto-stitch already in Inspect; still to do: sample a video window directly, seam blending. |
| **Proof annotation** | Grow the Geo Proof toolbox: shape fill + dashed strokes, numbered markers, a redaction/blur box; a document-level free layer so shapes cross panels and reach the margins; callout / zoom insets. |

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
time.

### v4: investigation layer

| Tool | What it does |
|------|--------------|
| **Map Board (MyMaps-style)** | Editable case map: custom pins + notes/links, shapes, layers; import/export KML/KMZ/GeoJSON; pins bind to `place`. |
| **Evidence Locker** | Track SHA-256, timestamps, source and notes; archive with Wayback; export `evidence.jsonl` under a hash-chained manifest, so any later edit to an exported file is detectable. |
| **Timeline Builder** | Timestamped events from mixed sources aligned on timeline + map. |
| **Report Builder** | Assemble proofs/maps/timeline/entities/notes into PDF or one self-contained HTML file with its media embedded, readable offline. |
| **Case Sync (Git)** | Push a case to a private or public Git remote, pull it back, and diff two revisions, so two analysts can work the same case. |

Toward v4: dependency-aware delete (partly done);
archive-on-download and a Wayback CDX snapshot timeline with diff; web-page save
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
| **Skyline Matching** | Trace a horizon in a photo, compare it against the DEM profile seen from candidate points. |
| **Vessel and Aircraft Tracks** | Historic ADS-B and AIS tracks on the map for a date, plus a watchlist that follows chosen callsigns or MMSIs. |
| **Map Measures** | Distance, bearing/azimuth, area, FOV cone; includes measure-on-imagery. |
| **Déjà Vu** | Perceptual-hash index flags recycled footage (local first; community index later). |
| **Manipulation Hints** | Add JPEG quantization, noise and AI-media hints alongside Inspect's ELA. |
| **Channel Monitor** | Watch Telegram channels, auto-archive media, queue for geolocation (rate limits, ToS care). |

Toward v5: real-world measurement from a resected photo and its GCP camera pose;
satellite-pass search from public TLEs.

### After the MapLibre migration

Phase 1 replaces Leaflet with MapLibre GL at 2D feature parity, with no 3D and
capture tests that verify the pixels. Phase 2 makes the map itself 3D — pitch,
public DEM terrain, extruded OSM buildings — and captures obliques with pitch and
bearing in provenance. Later work covers 3D satellite capture and user-keyed
Google Photorealistic 3D Tiles.

## 7. Loose ideas

No version yet. Promote an idea when its workflow is clear; delete it when it
stops making sense.

- **Free-form montage editor:** consider only if it stays distinct from Geo Proof and Inspect collage.
- **In-app OSINT assistant:** local chat and vision suggestions for analyst confirmation, with no cloud or API key by default.

## 8. Explicit non-goals

- No cloud, accounts, hosted service, or telemetry.
- No automated geolocation verdict; Azimut files facts for the analyst.
- No rebuilding specialized OSINT services; Azimut orchestrates them.
- No spreadsheet engine. The Case Sheet is a view of the graph, not a workbook:
  no formulas, no cell types, no second copy of the case.
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
- **Settings and secrets:** in-app tabs (Preferences / Imagery / About), keys
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
  media/notes/proofs; a closed folder is a complete copy); legacy `case.json` cases migrate
  on open; case open and lists use bounded, cursor-paged queries; thumbnails and
  background work run through a durable, recoverable per-case job queue drained by
  one worker. Details in [STORAGE_AND_PERFORMANCE.md](STORAGE_AND_PERFORMANCE.md).
- **Security posture** (single-user localhost): `127.0.0.1` bind + Host/Origin
  guard (DNS rebinding), 0600/0700 perms, hard 100 MP Pillow limit, content-hashed
  names for images pasted into a proof (no client-chosen path), token-gated
  ingest island for the extension. Accepted risks recorded here: cleartext keys over
  localhost, the hash-verified scraper updater, and tile/media URL fetches (SSRF
  only matters if the localhost assumption breaks). The startup update check is
  the one on-mount network call: opt-out and read-only against GitHub's releases
  feed, notes rendered as text (no HTML injection). Remote images embedded in a
  Notebook note contact their host whenever the preview opens; Notebook warns
  about that behavior and local Case media avoids it. Notebook diagrams are the
  one markup DOMPurify does not clear: Mermaid draws its SVG into the preview
  after sanitizing, under its own `strict` level, which escapes labels and drops
  click handlers. User-initiated imports,
  downloads and generated files have no app quota and can fill the workspace
  filesystem; disk capacity remains the user's responsibility.

## 10. Open questions

- Define entity attribute vocabularies, `same-as` merge semantics and confidence
  levels before Relations ships.
- Déjà Vu community index: needs infrastructure and moderation; out of scope
  until v5.
- Name/handle availability: GitHub org/repo `azimut`, x.com handle, domain.
