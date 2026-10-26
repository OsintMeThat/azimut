# Azimut product overview

Status: **spec v0.3** (2026-09-13). Read in order: Done → Roadmap → Loose ideas.
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
   network-dependent action, except for the optional startup version check
   (GitHub releases, PyPI for the downloaders).
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
  exports/     # finished exports and yours to fill
  .data/       # case.db, the authoritative SQLite graph, and entity photos
  .drafts/     # post drafts
  .inspect/    # each file's Inspect work: its frames and their edits
  .collages/   # collage layouts and their previews; the picture one exports is media
  .compare/    # saved Compare session specs
  .horizon/    # saved Horizon views and their previews, searches, the work in progress
  .analysis/   # Detect areas, saved detections, runs and the frames behind their results
  .search/     # saved Grid Search state
  .layers/     # added map layers: spec + source as received + its icons; .cache/ is derived
  .mapplates/  # map plates: a page laid out round the case's maps, and its preview
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
  | document | proof, post, note, sheet, inspect-session, collage, compare-session, horizon-view, map-layer, analysis-* (Detect), bookmark |
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
| ✅ **Media Library & Inspect** | Imports or downloads case media with metadata, provenance and hashes, then reviews images and video closely. |
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
| ✅ **Reports & templates** | Stores reusable proof and post structures, then prepares sourced Markdown for X or Bluesky. |
| ✅ **Case Notebook** | Edits linked Markdown notes with local media, Mermaid diagrams, PDF output and remembered export folders. |
| ✅ **Media at scale** | Downloads behind a login with a session named once, plus bounded search, searchable pickers, local metadata enrichment and GPS handoff to the map. |
| ✅ **Storage & recovery** | Uses per-case SQLite and durable jobs, with whole-case bundles, Trash and portable settings backups. |
| ✅ **Case utilities** | Opens case folders, reports scrubbed diagnostics, keeps filenames in sync and offers explicit Doctor repairs. |
| ✅ **Workspace portability** | Moves or adopts a workspace safely, recovers hand-added cases and prevents two live instances from sharing it silently. |
| ✅ **Updates & paste** | Reports available app, downloader and extension updates, then files supported clipboard content from the main case surfaces. |
| ✅ **Evidence on the map** | Places proofs and derived media through their evidence chain, with stated point uncertainty and footprints drawn under their pins. |
| ✅ **Map search** | Answers the search box while typing from saved work, a coordinate parse and a bundled gazetteer, and asks the geocoder only once typing stops. |
| ✅ **Ontology connections** | Keeps Relations, Mentions, Claim connectors and artifact lineage separate under one validated verb registry. |
| ✅ **Board & entities** | Provides the sortable Case Board, shared Details, typed creation, primary entity photos and a ticked selection deleted as one recoverable act. |
| ✅ **Case graph** | Draws registry-backed lenses with clustered nodes, readable edges, previews, a view budget and sources folded onto their edges. |
| ✅ **Working the graph** | Expands, folds, hides, searches and pins nodes per lens, with undo and no case mutation. |
| ✅ **Claim assessment** | Keeps statement confidence, relation confidence and source reliability separate, with explicit support and contradiction links. |
| ✅ **Structured findings** | Records associations, duplicate identifiers, asset condition, equipment models and statement totals without inventing missing values. |
| ✅ **Temporal Claims** | Dates a Claim with guided point, timestamp or interval input and files its subjects, places and evidence atomically. |
| ✅ **Case Timeline** | Aligns dated statements and media on a windowed axis read in UTC or a civil zone, with uncertainty, density, direct edits and Undated work. |
| ✅ **Timeline readings** | Builds coloured tracks from presets or Search+, then saves a changing Live view or a fixed Snapshot. |
| ✅ **Shared analysis views** | Shares one filter, saved-view family and fact-time window between Board and Graph, while Timeline keeps readings built for tracks and the Map only exchanges a window with them. |
| ✅ **Analysis view export** | Writes the Graph or the Timeline out as a vector plate carrying its lens, question, window, clock and legend, or copies it as an image. |
| ✅ **Case Sheet** | Opens and builds case CSVs in a plain grid: keyed rows, sorts, filters, row colour, clipboard both ways, bulk fill, undo and cells that point at case entities. |
| ✅ **Typed columns** | Types a column as a state, a list, a yes/no, a number, a point, a date or a picture, read by the sort, the filters, the map, the Timeline and the progress. |
| ✅ **A family of sheets** | Files a workbook one sheet per tab, forks a sheet, moves ticked rows under a column mapping, and confirms a reload or an overwrite when the file changed on disk. |
| ✅ **A sheet into the case, both ways** | Promotes a declared sheet into entities, places, vocabularies, row edges and dated Claims in one planned transaction, and builds a worklist back out of the case. |
| ✅ **Geolocation index** | Lays the case's proofs out one per row with their media, place and coordinates, and builds one proof per row back out of two address columns and a coordinate column, as a stoppable job. |
| ✅ **Imported proofs** | Turns a published post into a composed proof, every picture a panel and its text read for a position, with nothing filed before the preview is approved. |
| ✅ **Import origin** | States one origin for a whole import, offers it to a batch that landed without one, and corrects any file later from Details. |
| ✅ **Drawing on a proof** | Stamps a fixed set of marks, fills boxes and ellipses at a chosen opacity, keeps every shape tool in hand, and recolours, restyles, nudges, drags or deletes a picked family at once. |
| ✅ **Proof image transforms** | Turns or crops a panel or proof-owned overlay without changing its source, while keeping attached annotations on the same pixels. |
| ✅ **A proof of several points** | States every place a proof argues, each optionally named and moved on a map, files them under one title and carries them into the post and the exported picture. |
| ✅ **What a proof says about itself** | Carries an optional sentence, which is its notes and what a post is written from, and an optional date for its material, never pre-filled and shown on the Timeline. |
| ✅ **A date that reaches the footage** | A dated proof states that date for the original sources it rests on, as one cited statement restated on every save and never written over the file's own clock. |

### v3 GEOINT expansion (shipped as GitHub `v0.3.0+`)

| Tool | What it does |
|------|--------------|
| ✅ **Map navigation & captures** | Links map cameras, places case media and uncertainty footprints, and saves attributed captures with scale and north. |
| ✅ **Reference windows** | Fades a case picture over the map, steps and slows a clip and keeps a frame, unfolds dates, source and notes, and pins it to a corner clear of the map's controls or docks it in a column on either side, in the app and the extension. |
| ✅ **Map layers** | Stacks infrastructure overlays, FIRMS fires and VIIRS night lights, with case pins filtered by kind and folder. |
| ✅ **Imported & followed layers** | Imports KML, KMZ, GeoJSON and GPX, follows public My Maps and GeoConfirmed, and filters their legends and dates. |
| ✅ **Personal map layers** | Starts blank, from a file or from a My Maps link read once, then draws and edits markers, lines and areas on any map from a movable bar, styled with pictograms, every edit undoable, each feature described in a sheet that opens under its row, folds into sections, saves as it goes and explains itself on hover. |
| ✅ **Points into a layer** | Follows places, proofs and files of the case as they move and as they are saved (a proof and its footage are one marker, named by the proof's description), reads pasted coordinates, map links and posts, and takes a Geo Proof point, a file played on the map or another layer's feature from the same step-by-step menu. |
| ✅ **Layer days** | Filters a personal layer by day on its time strip and draws its dated features on an optional Timeline track. |
| ✅ **Layer downloads** | Download personal layers as KMZ with icons, KML or GeoJSON. |
| ✅ **Own icons** | Imports the analyst's icons in Settings (files, folders, zipped packs, SVG) for every layer's palette, in a disc or as they are; a layer keeps its copy and a copied map keeps its own. |
| ✅ **Layer colours** | Gives a group one colour while each feature keeps its icon, offers the colours a layer wears first, the plain ones, those picked lately and a typed code behind one press. |
| ✅ **Case key** | Names what each colour and icon stands for in the case, from a tag in the layer editor, its palette and its legend, and counts the legends by name. |
| ✅ **Layers followed over time** | Keeps a layer's features as dated states read on any day, today until the cursor moves, so every edit is dated, with what changed that day ringed and each feature's days said in its editor. |
| ✅ **Layers kept per case** | Reopens each case on the layers every map had on, fires and night lights excepted, and leaves off with a toast a layer that stopped the last session while drawing. |
| ✅ **Send to My Maps** | Saves a layer as it stood on one day as a KMZ, opens the analyst's My Maps beside it and says the three steps that replace its layer. |
| ✅ **Map plates** | Lays a page out round the case's maps (title, legend of what the frame draws, scale, north, inset, detail maps, grids, labels, numbers, arrows, zones, rings, cones, distances, tables, QR codes, pictures and forced credits) on a quiet or a toned ground, and exports it as a PNG, a print PDF, or its days as an MP4, a GIF or an evolution sheet. |
| ✅ **Plate looks** | Sets a plate in one press of a look, or by its paper, background, faces, colours, ground palette and imagery tone, signs it with the analyst's signature or Made with Azimut, and lines up, groups, locks and copies its elements across plates. |
| ✅ **Annotations by day** | Ties what is added on a played plate to the day it is made on, then shows it from a first to a last day picked on a calendar, so a video shows each day's annotations only. |
| ✅ **Plate steps & videos** | Plays a plate's day then its steps, each holding its own annotations and its own time in the video (a step at least its clip), and runs a case video on a step (its clip, sound and source line set in the inspector) inside the exported MP4. |
| ✅ **Map templates** | Keeps a plate's layout as a template, from the plate or in Settings, shares it as a file and starts new plates from it. |
| ✅ **Plate words & marks** | Sets the words of every plate element the same way (size, face, weight, style, colour, halo or box behind them), draws lines, texts and the layers' symbols on the map, and keeps the credits sharp at any zoom. |
| ✅ **Topographic & 3D plates** | Draws a plate's map on a topographic or staff-map ground (heights in colour, contour lines, summits, the Map's key-less layers), or in 3D on its heights with its ridge lines. |
| ✅ **Plate framing & transitions** | Frames a map day by day or step by step, and goes from one to the next in the MP4 by a fade, the map flying there drawn frame by frame (blurred or sharp) and what is new fading in or drawn. |
| ✅ **Plate workspace** | Widens or puts away the plate's list and inspector, folds the inspector's sections, finds what to add by a word, gives the page the whole screen in focus, and opens a plate in a tab of its own, edited in one tab at a time. |
| ✅ **Ready plates** | Starts a plate in one press or from New plate's one screen (layout, map, paper, look), on ten ready plates laid out for each paper (situation, geolocation card, before and after, incidents, track, line of sight, site, locator, briefing, post) and copied laid out for another paper. |
| ✅ **Plate grounds** | Draws a plate's map on ten vector grounds (newsroom, light grey, humanitarian, shaded relief, toner, tactical…) with airfields, military ground, road numbers, fine and disputed borders, set by detail and presence, names hidden or made labels by a click, or on Sentinel-2 cloudless, a year's mosaic said as one, or one dated Sentinel-2 pass. |
| ✅ **Plate type & blocks** | Sets a text in the page's styles (kicker, title, standfirst, caption, badge, key figure), adds ready blocks and editorial looks, and fills in coordinates, a played plate's period and counts of what the map shows. |
| ✅ **Plate locator & films** | Draws an inset as a globe with disputed areas apart, makes a layer of what was drawn or a new one to edit in the Map, and adds ready sequences, title and end cards, duplicated steps and each step's own transition time to the video. |
| ✅ **Plate focus & roles** | Lights one country and draws the rest of the world back (disputed areas half lit), gives a layer a role's look (held, claimed hatched, contested, front, events, context) named in the legend, draws every point, grains the paper and lets credits be taken off but a ground's. |
| ✅ **Plate export behind** | Exports a plate while the analyst works in another tool, the plate held still under a veil and the top bar saying how far, stopped in one press. |
| ✅ **Layers in every map** | Offers every layer, added ones included, in Compare, Detect and Horizon (Find's map included) from one Layers menu; Compare draws its one list on A, B or both, fires and nights on each side's day. |
| ✅ **Find hints & trust** | Takes several zoom words and compass directions when unsure (none ticked is any), draws the directions as a fan on Find's map, and says how far a search's best place can be trusted, why, and what the area fits by chance. |
| ✅ **Find: lines, ground and frames** | Says how far each traced line stands, where the eye stands (sea included) shown on the grid before the search, how the camera looks and whether it is a selfie, reads a phone's zoom by the picture's shape, and reads a stitched collage frame by frame. |
| ✅ **Find: zones, sun and speed** | Searches finer zones and leaves zones out, over areas up to 10,000 km², tries a point clicked on the map, turns where the sun stood on a day into headings, and searches large grids on several cores. |
| ✅ **Find: sea, lens and decoys** | Traces the sea's horizon with its own pen, measures a video's lens on its pan, and checks a search's places against decoys of its trace. |
| ✅ **Find: as searched** | Levels a collage as it is laid, lets one stretch of the trace miss, rounds near lines on coarse relief when asked, searches grids down to 20 m, and lays a photo looked from a place as the search read it. |
| ✅ **Find: sky only** | A line marked with only sky above lies on the top of the land and rules out the places where land stands behind it, saying how far out, read past the place's own reach on Auto; a grid picked is kept for hours of search, Auto goes down to 20 m on a small area. |
| ✅ **Find: lattice and kept skylines** | Lays the search's points in a hex lattice, a quarter fewer for the same reach, and reads the skylines an earlier search swept back from a bounded cache. |
| ✅ **Find: scored outward** | Scores each point of the grid from the camera its neighbours found, a third faster, keeping the places a full search finds. |
| ✅ **Find: the grid on the map** | Shows the grid before, during and after a search, paints points off or on with a brush, searches several areas at once, fills in as it runs and stops on the place confirmed, times itself on this computer, and leaves out what the photo rules out, the water's view checked in a Mesh step. |
| ✅ **3D map** | Stands Satellite's imagery on public relief, tilted by hand or key, and files a tilted view as a credited capture that reopens as it was taken. |
| ✅ **Globe 3D view** | Draws Satellite's 3D and a plate's 3D maps on a globe of the app's own whose eye only the hand moves, so the view never jumps as the ground loads; the map engine's former 3D view and its code are gone. |
| ✅ **Globe layers** | Draws what the flat map holds on the globe: borders, names and the analyst's layers, the case's places, measures and the sun's path, with clicks and cards as flat; active fires stay flat. |
| ✅ **Measure** | One tool for lines and areas, their legs, bearings and angles written on the map, where lines cross, and a line used as range rings, a view cone, a shadow's height and hour, or a viewshed; flat and on the globe. |
| ✅ **Ground & line of sight** | Reads the ground under a measured line on a press (at once in 3D), both ways with the map, coloured by what the eye at A sees or by slope, the sight stood in the air on the globe. |
| ✅ **Vector borders** | Draws Borders as OpenStreetMap lines from OpenFreeMap on every map, regions and districts in their own weight. |
| ✅ **Historical imagery & radar** | Browses Esri Wayback releases and dated Sentinel-1 passes, keeping acquisition dates separate from imagery releases. |
| ✅ **Satellite Compare** | Aligns and annotates dated imagery, echoes the pointer on the other side, highlights comparable changes, saves sessions and exports attributed PNGs, GIFs and evolution sheets. |
| ✅ **Detect** | Reviews Sentinel-2 and Sentinel-1 detections over shared areas, with pass coverage, cloud masks, custom analyzers and dated evidence. |
| ✅ **Capture extension** | Adds case map tools to third-party maps, hands media to publishing and reverse search sites, and supports extension updates. |
| ✅ **Home, Guide & tasks** | Opens recent case work and named task lists from Home, with contextual guidance for each tool. |
| ✅ **Pictured guide** | Opens over any tool from the `?`: every tool photographed and numbered, numbers that open the next screen, a geolocation walked to its published thread, pictures remade by `npm run guide:shots`, and a welcome at each new version pointing at the `?`. |
| ✅ **Inspect, Collage & Reverse Search** | Autosaves work per file, arranges extracted frames into collages and sends original or cropped pictures to reverse search. |
| ✅ **Collage: straighten** | A line drawn along something level bends the whole collage flat as one picture, seams kept; Find then reads it as one. |
| ✅ **Inspect player & panel** | Captures the very frame on screen, lays frames, marks, shots and sound along the bar, and keeps Capture and Save above Info, Adjust, Moments and Analyze tabs. |
| ✅ **Proof annotations & publishing** | Adds numbered markers, blur boxes, box tags, callouts, zoom insets, view cones and line styles, puts marks free on the page or tied by their ends across panels, sets the proof in shipped fonts, keeps line widths and sizes the same on every panel, verifies proof points and carries proof dates into previewed post templates. |
| ✅ **Dates & Timeline** | Shares date entry and clock selection, draws temporal precision explicitly and adds cited events from any tool. |
| ✅ **Subjects & case analysis** | Corrects and merges subjects, indexes their events, searches across scripts and reviews proposed account and site connections. |
| ✅ **Geolocation worklists** | Opens recent sheets, tracks imported files awaiting a proof and indexes every proof point with its date, source and coordinates. |
| ✅ **Files & navigation** | Files work into the active folder, files a Media Library card dragged onto a sidebar folder, offers contextual actions and filters, and retraces tools and documents with guarded Back and Forward. |
| ✅ **Command palette** | Ctrl+K or ⌘K searches tools, cases and current-case documents, starts with recently added items and protects unsaved work. |
| ✅ **Shared analyzers & areas** | Exports an analyzer of your own as a file, checks included or left behind, and an area or a group as the ground it is, names, colours and folder kept. Imports either without overwriting what is here, so the work travels without the settings backup and its keys. |
| ✅ **Copernicus layers & figures** | Writes composite, index and script layers with a preview on the map, offers them in every map tab, reads an index or single-band layer as a Detect rule, draws a rule back as a layer and moves its line live on the last test's readings, and lays several renderings of one pass out as a captioned figure. |

---

## 6. Roadmap

Each version delivers one complete daily workflow. Firm ideas move here from
§7. New tools become tabs or modes in an existing workspace (see
[UI.md](UI.md)). Releases ship as GitHub `v0.x` tags.

### v3: GEOINT expansion

| Tool | What it does |
|------|--------------|
| **Horizon buildings** | Buildings stand in Horizon round the eye, from open sources merged by a stated rule (national surveys, OpenStreetMap, Overture, 3D-GloBFP, Google's 2.5D heights), each saying where its height comes from; a saved view keeps them. |
| **Fires on the globe** | Draws active fires on the globe within their allowance. |
| **Camera Resection (GCP)** | Marks matching points photo↔map, then solves camera position, viewing azimuth and rough FOV (OpenCV `solvePnP`) and saves the match as evidence. Its photo canvas and pixel↔angle camera frame are built for two callers: Sky Clock fills the same frame by hand. |
| **Capture graticule** | The rest of what a plate states about itself: a latitude/longitude grid over app and extension captures, beside the scale bar and north arrow that already ship. |
| **Image Compare** | Overlay two images with opacity, swipe and pixel diff. Assist satellite-to-screen alignment without presenting a verdict. |
| **Georeferenced overlay** | Pins an image to the ground by three or four matching points: a commercial satellite shot from a post, a drone frame, an old plan. It draws under the map's own marks with an opacity slider, reprojects as the map pans, and is saved in the case with its control points so the fit can be checked. |
| **Adopt a feature** | Turns a feature of an added layer into a `place` of the case, carrying the layer and the feature it came from as provenance. |
| **Source directory** | Keeps the accounts, channels and pages worth following for this case, searchable by platform, area and topic, with notes and source reliability; monitoring remains a later opt-in workflow. |
| **Metadata follow-up** | Explains which common image/video fields were stripped and proposes events from capture times. |
| **Edit Provenance** | Reads a rendered video's own edit history: which source clips it was cut from, in what order, and the GPS, dates and cameras those clips still carry. |
| **Sky sessions** | Saves a sun or moon lookup as a case artifact: the point, the date and the time, never the numbers they produce. It reopens where it was left, a proof can show its reading, and a statement can cite it. |
| **Grid sessions in the graph** | Brings the saved AOI grids into the case as entities, adopting the specs already on disk. Grid Search is the last saved tool state living outside the graph, so today nothing can say "this sweep is how I found it". |
| **Sky Clock** | Marks a shadow, the sun or the moon in an image or a video frame, with the horizon and north giving the angles, then renders the year as a day × hour heatmap of the slots that fit. A visible moon also carries phase and bright-limb angle, which usually cuts a year down to a few instants. |
| **Case KMZ** | One self-contained file per case: a pin per place, carrying the notes and proof images it is linked to, opened in Google Earth. Frozen rather than live, because only the web Earth remains and it follows no network link. |
| **Event layers** | The rest of what dates an event from the sky: archived weather and METAR, beside the fire detections that already ship. |
| **OCR** | Reads signs and plates on import (tesseract, a native binary rather than a wheel), and detects script and language. |
| **Audio Transcript** | Transcribe and translate speech offline; flag acoustic context such as bells, adhan, aircraft or language. |
| **Ground Imagery** | Ground-level photos: Panoramax/Mapillary/KartaView key-less first; Street View easy link, optional keyed in-app view. |
| **Panorama** | Stitch a video window / frame set. Auto-stitch already in Collage; still to do: sample a video window directly, seam blending. |
| **Detached tool windows** | The rule the map already follows, applied to the rest: a read-and-work surface (Board, Graph, Timeline) opens as many tabs as wanted and the tab it left stays live; a document editor opens one window per document and is greyed out where it was. Cross-tool handoffs route to wherever the tool now lives. |

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
| **Evidence Locker** | Track SHA-256, timestamps, source and notes; archive with Wayback; export `evidence.jsonl` under a hash-chained manifest, so any later edit to an exported file is detectable. |
| **Report Builder** | Assemble proofs/maps/timeline/entities/notes into PDF or one self-contained HTML file with its media embedded, readable offline. |
| **Case Sync (Git)** | Push a case to a private or public Git remote, pull it back, and diff two revisions, so two analysts can work the same case. |

Toward v4: archive-on-download and a Wayback CDX snapshot timeline with diff; web-page save
extension; provenance stamp on exports (short hash, optionally visible) that
re-identifies a shared PNG in its case; source
location pattern-of-life map and timeline; cross-case handle/coordinate/face
search; optional quota-aware X publishing.

### v5: orchestration and advanced

| Tool | What it does |
|------|--------------|
| **Search Orchestrator** | Run username/alias/email across services, analyst selects → entities. Integrations, not clones. |
| **OSM Query (Overpass)** | Feature search from a form, and a described pattern ("filling station, roundabout, railway within 300 m") turned into candidates on the map; clicking a point looks it up in OSM, Wikidata and geolocated Commons photos. No Overpass QL. |
| **Camera Track (video SfM)** | Solves a moving camera's path from a video: frames sampled from a window, position and viewing azimuth per keyframe, and a sparse point cloud. Reports insufficient parallax instead of guessing. Bundles a native SfM binary (COLMAP/GLOMAP), CPU-capable. |
| **Vessel and Aircraft Tracks** | Historic ADS-B and AIS tracks on the map for a date, plus a watchlist that follows chosen callsigns or MMSIs. |
| **Map Measures** | Measure on a resected photo's imagery, and a bearing layer that absorbs the v2 sun/moon arcs. |
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
- **Free-form montage editor:** consider only if it stays distinct from Geo Proof and the Collage tool.
- **In-app OSINT assistant:** local chat and vision suggestions for analyst confirmation, with no cloud or API key by default.
- **Geographic playback:** step through dated case items on the map instead of showing one fixed Timeline window.
- **More on the home page:** the case's own notes beside the tiles, and panels the analyst arranges rather than a fixed grid. Each has to earn its place there rather than beside Board, Graph and Timeline, which already read the case.
- **Radar damage from a stack of passes:** the pixel-wise t-test (PWTT) over a year of passes before and weeks after, which two passes cannot match.
- **Oil slicks by radar:** dark patches on the sea near anchorages and lanes, which Sentinel-1 shows through cloud.
- **Map files out of the case:** export pins, claims and Detect findings as KML or GeoJSON, with TimeStamp and TimeSpan so another viewer's time slider reads them.
- **Update ffmpeg from the app:** download a static build into the workspace and prefer it at runtime, like the scraper update, if the bundled copy ever lags in a way users hit.
- **Vector text in plate PDFs:** the PDF holds the page as one print-resolution picture; selectable text needs the plate's faces as TTF on the Python side.
- **Place names kept whole at a plate map's edge:** the engine cuts a name the frame crosses; placing them away from the frame would need its own label pass.
- **A Sentinel-2 pass per day of a played plate:** a plate's map holds one dated pass; following the play's days would spend the analyst's quota on every export.
- **Place names in their own script:** the Arabic or Cyrillic name under the Latin one, for searching local sources. Needs the engine's right-to-left text plugin, bundled rather than fetched.
- **Free band formulas in Detect:** a rule read on an expression the analyst writes. A normalised difference and a single band already work, including from a layer they wrote, so what is left is the general case — an arbitrary expression needs its own product family, a generated evalscript and thresholds calibrated on real scenes.
- **A deleted case waits before it is gone:** artifacts, entities and bulk deletes are all recoverable, while removing a case is the one act with no way back and only a typed DELETE in front of it. Move the folder aside instead, and empty it later.
- **A fire detection to click:** the points the app already draws close in, read back under the pointer for the detection's time, satellite, confidence and power.
- **A live public map:** a layer published as GeoJSON at a public address (a Gist) that a uMap remote-data layer reads, so one press updates a map others follow.
- **Dated layers by side in Compare:** a GeoConfirmed or other dated layer showing on each side only what was known by that side's date.
- **Find, narrower still:** near a road or a track (OpenFreeMap's transportation layer, a line decoder and a tile cap per area), turns kept between searches of one area, a mirrored place shown flipped in Overlay, and the lens searched for a collage laid wholly by hand.
- **Sun and moon on the globe:** the bodies in the 3D view's sky at the hour the Sun & moon panel is on, and the relief lit from where the sun stands then.
- **The sky over the area, not the tile:** Detect's pass list and its newest pass judged by the cloud over the drawn area (one small SCL read per pass) rather than the 110 km tile's figure.

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
- **Frontend**: Svelte + Konva/canvas, served by the backend, opened in the
  default browser. The map is MapLibre GL behind `lib/map`'s façade, so tools
  speak points, positions and view events and never the engine. Satellite's 3D
  view is a WebGL2 globe of the app's own (`lib/globe`) answering the same
  façade while it is on, and drawing the flat map's own layers by reading its
  style (`lib/globe/mirror.js`); a plate's 3D map stands on the same globe. Rail =
  workspaces in pipeline order, tools are tabs inside them (see
  [UI.md](UI.md)).
- **Settings and secrets:** in-app tabs group general preferences, publishing,
  imagery, templates, the capture extension, storage and system tools; keys
  stored locally and never bundled into a shared case, monthly usage counters,
  backup export/import, opt-out "new release is live" pop-up on load (per-version
  "don't show again"). Display preferences affect presentation only; artifacts keep
  decimal degrees + metres on disk.
- **Distribution:** `pip install azimut` plus PyInstaller single-file binaries
  for Windows x86_64, Linux x86_64 and Apple Silicon macOS. Binaries bundle a
  static ffmpeg/ffprobe with its licence notice and texts (Settings → System →
  licence); pip installs still want ffmpeg on `PATH`. Intel macOS uses the Python
  package.
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
  guard (DNS rebinding), which also refuses a foreign page's `Sec-Fetch-Site` on
  the API and the case files, since an image or a link sends no Origin on a GET;
  0600/0700 perms, hard 100 MP Pillow limit, content-hashed
  names for images pasted into a proof (no client-chosen path), token-gated
  ingest island for the extension. A case file is served `nosniff`, and under a
  `sandbox` policy unless its type only displays, so an SVG or a page that arrived
  in a bundle never runs script in the app's origin. The one route that reads a case file back out
  of that island — the attachments a composer hand-off carries — fences on the
  **resolved** path, so `media/../case.json` is refused where a prefix read off
  the request would have served it. Filling a composer and handing a picture to a
  reverse-image engine are the extension's only reach past localhost — eight
  hosts, declared, where it writes what the app gave it and reads nothing — and
  each switch that uses one is in the app (Settings → Publishing, Settings →
  General), where the analyst already decides how a thread is published and which
  engine gets the picture. The engine road carries the image itself rather than a
  path, since what Reverse Search prepares is a canvas frame that exists nowhere
  on disk, and it is the one hand-off whose page acts on what it is given: these
  engines search as soon as they hold a picture, which is what the button was
  pressed for. Seven of those hosts are the engine or the composer itself; the
  eighth is `www.google.com`, which is broader than the rest and is an accepted
  risk rather than an oversight: Lens redirects `lens.google.com` to the search
  home page and draws its uploader there, so the grant has to cover wherever that
  redirect lands. It buys nothing beyond that — the extension injects only into a
  tab it opened itself, at a URL the app handed it, and reads nothing back.
  Updating that extension writes the app's *own* bundled bytes into
  one fixed workspace path and takes nothing off the request — no path, no
  payload — so it sits on the settings router rather than in the ingest island,
  where the extension-origin CORS would have reached it; the message that then
  restarts the extension is only reachable from the page on the port the extension
  is paired with (any other localhost port is refused, told which address to set,
  and may only ask which copy is loaded; hand-offs open only the posting sites and
  image engines the app offers),
  names the install it means, and its worst outcome is an extension that
  restarts. The map tools widen that island by five read routes and two writes,
  each trimmed to what a panel draws — one position's points without their
  thumbnails or link tallies, a sweep's own spec, a case's images and videos by
  name — and the panel
  itself reaches them only through the worker's own allowlist, since a content
  script's fetch would carry the map site's origin and be refused. It is drawn
  in a closed shadow root and acts only on events the browser dispatched, so the
  map site can neither read the panel nor press it. Keeping those
  panels in step adds one more, and it is the narrowest of them: a read-only
  stream of what changed, never of what it says, so an event names a case and a
  file and the panel re-reads it through the routes it already had. The worker
  holds it and no panel is given it, which is the same fence as the rest — and
  it is deliberately not on the relay's allowlist, being one answer that never
  ends. The bytes of a
  picture come back over the hand-off's own route, behind the same fence: media
  and proofs, resolved, and nothing else in the case. A case id and an artifact name each address
  one directory entry, checked against POSIX *and* Windows path rules so the
  separator only one of them honours cannot walk out of the workspace. The workspace pointer is the one file written
  outside the workspace, 0600 and holding a path; deleting the copy a move set
  aside acts on this process's own memory, never on a path from the request.
  Accepted risks recorded here: cleartext keys over
  localhost, the hash-verified scraper updater, the release workflow's publish job
  running `softprops/action-gh-release` and `pypa/gh-action-pypi-publish` on mutable
  refs while it holds the PyPI OIDC identity (the branch ref is the form PyPA
  documents; every other action in the workflows is pinned by tag or by commit),
  the CLA workflow's write token on `pull_request_target` (it never checks out the
  pull request's code, and its one action is pinned by commit),
  tile/media URL fetches (SSRF
  only matters if the localhost assumption breaks), and a download that fails
  saying only that the content is unavailable being retried with the stored
  browser session, so a merely deleted post gets the analyst's cookies — kept
  because a hundred-row press cannot stop on a question and the first attempt is
  always cookie-less. A sheet's link check refuses a literal loopback, private or
  link-local address on the first hop and on every redirect; a hostname that
  resolves to one is not looked up to find out, and what such a hop could learn is
  "this port answered" and never a body. An imported workbook is bounded on its
  compressed bytes and on the size its own directory declares once unzipped. An
  added map layer is the second untrusted archive and the first untrusted XML: a
  KML is parsed by `defusedxml`, which refuses an external entity and an expansion
  bomb, under bounds on size, feature count and nesting depth, and a KMZ is a zip
  checked for an escaping member name, its uncompressed total and its compression
  ratio before a byte of it is read. The browser never sees any of it — it is
  handed the parsed GeoJSON, with every description stripped of markup at the
  boundary rather than rendered. A layer's own icons are the one thing it can ask
  a third-party host for, on an explicit tick at import and never afterwards, and
  the accepted risk is bounded on both ends: what goes out is a per-image GET
  under a count, a size and a total cap, and what comes back is decoded, tinted,
  resized and **re-encoded here**, so an SVG carrying a script, a file pretending
  to be a PNG and a thumbnail that unpacks into a gigabyte are one refusal rather
  than three checks. The browser only ever loads PNGs this process produced, from
  localhost, keyed by content hash. Following a public Google My Maps uses
  `google.com/maps/d/kml?mid=…`, the KMZ rather than the `forcekml=1` conversion
  beside it: both carry the same placemarks, but the archive bundles the
  creator's actual icons as members of itself, while the conversion throws the
  pictograms away and points every style at one of three blank Google
  containers. It is undocumented, and is an
  accepted risk recorded here rather than one taken silently: SPEC §2 refuses the
  unofficial key-less endpoints of keyed services (the `mt1.google.com` case), and
  the distinction drawn is that this is the sharing mechanism the map's own
  creator switched on, not a way around a quota. It is fetched only when the
  analyst subscribes, presses Refresh, or switches the layer on for the first
  time in a session, when it asked to be re-read then. A layer received in a
  bundle is not re-read on switch-on, since its sender set that and chose the
  address; it waits for a Refresh pressed here. Every added layer starts
  off when the app or the page opens again, so a layer heavy enough to take the
  tab down does not take it down again on reload; a shape it stops answering in
  fails with a sentence
  rather than drawing nothing. A GeoConfirmed layer rides on those same three
  acts, plus one: its dialog reads the conflict list when the analyst opens it.
  Each read is GeoConfirmed's documented, key-less public API, through the
  backend and under a User-Agent naming the app, as it asks integrations to do;
  its `robots.txt` disallows `/api/` for crawlers, which a read the analyst asked
  for is not. The icons arrive inside the export, so they cost no request. The
  map's search bar answers from a bundled gazetteer and never reaches out on a
  keystroke; its geocoder layer
  waits for a pause, and a request the one-per-second pace cannot take is dropped
  rather than queued. Two things reach out on mount and no
  others. The startup update check: opt-out, and read-only against GitHub's
  releases feed plus PyPI's JSON for the two downloaders, both governed by the
  same switch. And the home page's map of the case, which fetches basemap tiles
  for the points the case already holds — through the same proxy as every other
  map, from the keyless unmetered provider only, so it spends no allowance and
  asks for nothing a case with no saved point would. Release notes are rendered through the Notebook's
  DOMPurify-sanitized Markdown renderer rather than as raw HTML. The capture
  extension is compared locally, so it is answered with the switch off — except
  the Firefox copy, which Mozilla signs and the browser therefore updates itself:
  it polls the release's update manifest on its own schedule, past any switch the
  app has, and is recorded here as an accepted risk for the only permanent
  Firefox install that exists. Horizon's buildings reach their hosts only while
  their switch is on: OpenFreeMap, the Géoplateforme's WFS, source.coop (the 3D
  BAG), NRW's OGC API, NYC Open Data, Overture's catalog and tiles, figshare
  (3D-GloBFP) and Google's public bucket (2.5D heights). A 3D-GloBFP grid,
  Google's heights or Overture's footprints are read only after the analyst says
  yes to their size. They are third-party binaries parsed locally (a zip, a
  shapefile, a PMTiles archive, a GeoTIFF), an accepted risk bounded by fixed hosts and readers
  that refuse what they do not know: zip members are written by their stem only,
  never by their path. A plate's Sentinel-2 cloudless ground reaches EOX's tile
  server (`tiles.maps.eox.at`) only once the analyst picks it, through the same proxy
  as every basemap; the years it offers and their licences are answered by the app. Remote images embedded in a
  Notebook note contact their host whenever the preview opens; Notebook warns
  about that behavior and local Case media avoids it. Notebook diagrams are the
  one markup DOMPurify does not clear: Mermaid draws its SVG into the preview
  after sanitizing, under its own `strict` level, which escapes labels and drops
  click handlers. Three routes take a picture drawn in the browser back: the note
  PDF export, whose request, diagrams and decoded total are bounded before
  rendering, every diagram read as an image and the note's own text re-read from
  disk rather than trusted from the request; the analysis plate, bounded the
  same way and inspected before it is written, since a plate lands where documents
  are opened — it must start as an SVG and carry no script, event handler,
  embedded document or reference leaving the file; and saving a proof, which posts
  the composer's rendered export and the images pasted into it, bounded as a
  request and again as a decoded picture. A map plate's export is bounded as a request
  too; a played plate's pictures come first in bounded batches, are checked by their
  header (a PNG or a JPEG, bounded in pixels) and kept on disk as they came under a
  random token, so ffmpeg is what decodes them; the export, a Stop or 15 idle minutes
  lets them go. Every body the browser assembles whole —
  a table, a note, a picture — is refused by size before it is parsed, and the
  routes are not trusted to a list: `tests/test_hardening.py` walks them.
  Case imports extract only unique, non-symlink members declared
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
