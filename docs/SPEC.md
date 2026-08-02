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

The workspace is `~/Azimut` unless it was moved: `AZIMUT_HOME` wins, then a
one-line pointer file at the platform's configuration location, then the
default. A directory per investigation (`~/Azimut/<case>/` by default):

```
README.txt     # which half of the folder is whose
azimut/        # everything Azimut owns; the rest of the folder is yours
  case.json    # small manifest: name, dates, storage format + schema
  notes.md     # free-form case notes (markdown)
  notes/       # note bodies, named after their title, filed as in the notebook
  media/       # source + captured + extracted media; .meta/ holds the sidecars
  proofs/      # exported PNGs; .meta/ holds the specs and pasted images
  exports/     # notes exported to PDF, and yours to fill
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
| ✅ **Saved work navigation** | Groups a case's places, captures and filed screenshots by continent/country/region (labelled in English and the local language) or by My-work folder, searchable in either spelling with previews and shown on the map at its default zoom when none was saved. |
| ✅ **Geo Proof** | Composes templated grid or free-layout panels with annotations, coloured frames and pasted overlays that stay out of the case, and exports a PNG with an editable spec. |
| ✅ **Geo Report** | Prepares sourced proof threads and saved drafts without posting automatically. |
| ✅ **Case sidebar** | Searches and filters the case, manages notes, suggestions, folders, multi-row filing, a details drawer and synchronized artifact deletion. |
| ✅ **Imagery providers** | Supports Esri, OSM, OpenTopoMap, Sentinel-2 and optional Mapbox/Google with usage controls. |
| ✅ **Sentinel-2 cloud ceiling** | Renders cloudy passes by default and lets a slider set the ceiling, which the tiles, the calendar and "most recent" all follow. |
| ✅ **Capture extension** | Files user-initiated map screenshots with URL metadata, attribution and provenance; also saves a map's point as a place, or any page as a bookmark. |
| ✅ **Distribution** | Bundles the browser UI, launcher, cross-platform binaries, ffmpeg, locked builds and server hardening. |

### v2 GEOINT suite (shipped as GitHub `v0.2.0+`)

| Tool | What it does |
|------|--------------|
| ✅ **Coords & Sky** | Converts common coordinate formats, copies results, opens map or geocoding links, and borrows a point already saved in the case instead of retyping it. |
| ✅ **Sun, moon and local time** | Rise, set, azimuth, altitude, twilights, moon phase and bright-limb angle for a point and date, each instant in civil local time and UTC, with a day chart and a compass rosette. Polar day, polar night and a date without a moonrise are states. |
| ✅ **Sun & moon on the map** | A map mode: one date's path from an anchored point, as the arc each body sweeps while up, hour ticks, and the bearing at a draggable hour. |
| ✅ **Reverse Search** | Prepares image or video frames for keyless reverse-image services without uploading automatically. |
| ✅ **Grid Search** | Saves editable AOI grids with keyboard review states and place promotion. |
| ✅ **Templates** | Stores reusable proof styles and post-thread structures at workspace level. |
| ✅ **Geo Report outputs** | Targets X, Bluesky or Mastodon and saves structured Markdown notes with evidence links. |
| ✅ **Case Notebook** | Edits tabbed Markdown notes with local media, entity links and broken-reference markers. |
| ✅ **Notebook diagrams** | Draws ```mermaid fences in the preview and the PDF, loading the library only when a note holds one. |
| ✅ **Notes to PDF** | Exports the open note or a ticked selection as one server-rendered file per note, with stable homonym names, bounded diagrams and bundled faces for living scripts including CJK. |
| ✅ **Export destinations** | Remembers separate app-wide folders for note PDFs, media copies and proof PNGs, defaults to the case's `exports/` and atomically avoids overwrites elsewhere. |
| ✅ **Canvas tests** | Exercises Leaflet and Konva interactions in Chromium and Firefox. |
| ✅ **Storage platform** | Uses per-case SQLite, bounded catalog queries and a durable one-worker job queue. |
| ✅ **Case bundle** | Exports and imports the whole case folder, including the analyst's free zone, with integrity checks and optional whole-bundle password protection. |
| ✅ **Trash** | Holds deleted artifacts for restore or explicit permanent deletion. |
| ✅ **Gated downloads** | Fetches login-walled media by borrowing a browser session or cookies.txt, cookie-less by default and prompted only on a wall. |
| ✅ **Find at scale** | Bounded, paged loading with a shared search box and sort across the Media Library and Files, plus case-name search in the switcher. |
| ✅ **Searchable pickers** | Pickers in Inspect, Reverse Search, Geo Proof and the Notebook notes menu search past six entries and browse case folders behind the "…". |
| ✅ **Report an issue** | System writes a bug or a request into a pre-filled GitHub issue, with version, OS and the run's last warnings, home path and account name scrubbed. |
| ✅ **Settings backup** | Carries portable settings, keys, presets and the signature while leaving machine paths and download sessions behind. |
| ✅ **Open the folder** | A case's folder, or the whole workspace, opened in the system file manager. |
| ✅ **Proofs on the map** | A fourth position of the Saved switch places each proof by its own coordinates, then by the captures it composes; `All` marks a worked capture with a dot rather than doubling it. |
| ✅ **Import enrichment** | Reads image EXIF/dHash and video container/stream metadata locally in the background; parsed GPS produces linked Suggestions and all fields appear in Details. |
| ✅ **GPS in Media** | A GPS filter and a per-row pin in the Media list send a stated position to the map, images and videos alike. |
| ✅ **Relation vocabulary** | One registry for the non-chain edges, stated or settled from Details and from a point's card on the map. |
| ✅ **Visible file names** | Shows each file-backed artifact under its filename stem and moves the file when that name changes. |
| ✅ **Case doctor** | Checks a case without changing it, then offers explicit repairs for a missing database, missing media and files dropped into `media/`. |
| ✅ **Workspace folder** | Settings adopts a folder as it is, or copies and SHA-256-verifies every file before switching an external pointer and keeping the old copy. A missing configured folder stops startup. |
| ✅ **One Azimut per workspace** | An OS-held lock the kernel drops on exit, with a heartbeat so a folder shared between machines can tell a live holder from a crashed one. The second instance opens to a screen naming the first, and can overrule it. |
| ✅ **Adopt a case folder** | A folder made in the workspace from the file manager becomes a case on one click, where it is, without reading or moving what it holds. One holding a case that lost its manifest is recovered instead, then handed to the Doctor. |


---

## 6. Roadmap

Each version delivers one complete daily workflow. Firm ideas move here from
§7. New tools become tabs or modes in an existing workspace (see
[UI.md](UI.md)). Releases ship as GitHub `v0.x` tags.

### v2: still to finish (next `v0.2.x`)

| Tool | What it does |
|------|--------------|
| **Case Board / Relations** | Browses, creates and merges entities; graph view over the schema filled since v1, on the shipped relation vocabulary. |
| **Case Sheet** | The same case as a table: a row is an entity, columns are its attributes plus free ones the analyst adds, sorted, filtered and edited in place. Imports a CSV as loose rows that stay out of the graph until promoted, and exports back to CSV or GeoJSON. |
| **Camera Resection (GCP)** | Marks matching points photo↔map, then solves camera position, viewing azimuth and rough FOV (OpenCV `solvePnP`) and saves the match as evidence. Its photo canvas and pixel↔angle camera frame are built for two callers: Sky Clock fills the same frame by hand. |
| **Command palette** | Ctrl+K reaches a tool, a case or an artifact. |
| **Capture scale and north** | Preference-controlled scale bar, north arrow and graticule on app and extension captures. |

Toward v2: split Satellite.svelte into `lib/` modules, before the map engine
changes under it.

### v3: GEOINT expansion

| Tool | What it does |
|------|--------------|
| **Map engine (MapLibre)** | Replaces Leaflet with MapLibre GL at 2D parity: same providers, same captures, and the capture tests still verify the pixels. Ships before the 3D map, which builds on it. |
| **3D map** | Pitch, public DEM terrain and extruded OSM buildings on the MapLibre map. An oblique capture records its pitch beside the bearing, so the view can be reproduced. |
| **Satellite Compare** | Same coords across providers (Esri / Sentinel-2 date slider / Bing / keyed), synced pan/zoom. Copernicus easy link. |
| **Image Compare** | Overlay two images with opacity, swipe and pixel diff. Assist satellite-to-screen alignment without presenting a verdict. |
| **Metadata follow-up** | Explains which common image/video fields were stripped and proposes events from capture times. |
| **Edit Provenance** | Reads a rendered video's own edit history: which source clips it was cut from, in what order, and the GPS, dates and cameras those clips still carry. |
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
Photorealistic 3D Tiles on the user's own key.

## 7. Loose ideas

No version yet. Promote an idea when its workflow is clear; delete it when it
stops making sense.

- **Media in the analyst's half:** a button that looks for media beside `azimut/` and offers to bring them into the case, rather than waiting for them to be moved into `media/` by hand.
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
  ingest island for the extension. The workspace pointer is the one file written
  outside the workspace, 0600 and holding a path; deleting the copy a move set
  aside acts on this process's own memory, never on a path from the request.
  Accepted risks recorded here: cleartext keys over
  localhost, the hash-verified scraper updater, and tile/media URL fetches (SSRF
  only matters if the localhost assumption breaks). The startup update check is
  the one on-mount network call: opt-out and read-only against GitHub's releases
  feed, notes rendered through the Notebook's DOMPurify-sanitized Markdown
  renderer rather than as raw HTML. Remote images embedded in a
  Notebook note contact their host whenever the preview opens; Notebook warns
  about that behavior and local Case media avoids it. Notebook diagrams are the
  one markup DOMPurify does not clear: Mermaid draws its SVG into the preview
  after sanitizing, under its own `strict` level, which escapes labels and drops
  click handlers. The PDF export is the one place a picture drawn in the browser
  is posted back: the request, each diagram and their decoded total are bounded
  before rendering, and every diagram is read as an image,
  and the note's own text is re-read from disk rather than trusted from the
  request. Case imports extract only unique, non-symlink members declared
  by the manifest and matching its SHA-256. Password-protected bundles seal the
  complete ZIP with chunked AES-256-GCM and a scrypt-derived key; filenames stay
  encrypted and the password is never persisted in a job. Import temporarily
  stages a decrypted ZIP inside the incoming case directory. Imports validate
  declared and actual sizes, reserve filesystem headroom and warn above 10 GiB;
  downloads and generated files still have no app quota.

## 10. Open questions

- Define entity attribute vocabularies, `same-as` merge semantics and confidence
  levels before Relations ships.
- Déjà Vu community index: needs infrastructure and moderation; out of scope
  until v5.
- Name/handle availability: GitHub org/repo `azimut`, x.com handle, domain.
