# Ozimut — the OSINT investigator's workbench

> One case, one folder, every tool. Local-first: your media and your investigations
> never leave your machine. Built for the open-source-investigation community
> (GeoConfirmed contributors, journalists, researchers).

Status: **draft spec v0.2** (2026-07-08) — supersedes v0.1, which framed Ozimut as a
collection of geolocation tools. v0.2 reframes it around a single story. Everything
here is open to change.

---

## 1. The story (read this first)

Ozimut is **not** a geolocation app, and it is **not** a Maltego competitor.

Ozimut is **the desk where an OSINT investigation lives**. GEOINT (geolocation
proofs) is its flagship pillar and the v1 focus, but every facet of an
investigation — media, people, places, timelines, evidence, reports — belongs in
the same case.

Today an investigation is scattered across 50 browser tabs, three Windows folders,
Obsidian, Draw.io, Google Earth, a paint program and a notepad. Ozimut replaces
that mess with one promise:

> **Close Ozimut. Reopen the case six months later. Everything is there:**
> the downloaded media, the annotated proofs, the entities and their links, the
> timeline, the notes, the exports — in one plain folder you can zip, git, or share.

Every design decision is tested against that sentence.

## 2. Why

Practitioners juggle a dozen half-broken web pages and manual workflows every day:
composing a geolocation proof in a paint program, comparing satellite providers in
four tabs, losing evidence to link rot, re-deriving sun positions, and — worst of
all — **losing the thread of the investigation itself** because nothing ties the
artifacts together. The tools that exist are abandoned, paid, or require uploading
sensitive media to someone's server.

Ozimut bundles the daily gestures into one installable app and ties their outputs
into a case, with a simple guarantee: **everything runs on your machine.**

## 3. Principles

1. **Local-first, privacy-first.** No account, no telemetry, no upload. Network is
   used only when a tool inherently needs it (map tiles, geocoding, media download)
   and always to third parties directly — never through an Ozimut server.
2. **The case is the product.** Tools are how you work; the case folder is what you
   keep. Plain files (JSON + media), human-readable, versionable, portable.
3. **One tab = one tool, useful in 30 seconds.** Every tool works one-shot with no
   case open (a scratch case is created silently and can be discarded or promoted).
   Tools share data through the case, but never require ceremony.
4. **Orchestrator, not replacer.** Ozimut does not rebuild specialized OSINT
   services (email lookup, username search engines, …). It launches them,
   collects what the analyst selects, and files the results as entities with
   provenance. Build integrations, not clones.
5. **Tools emit facts, the analyst decides.** Tools may *suggest* entities and
   links (OCR found "Rue Victor Hugo", EXIF found GPS) but never create them
   silently. Every suggestion is confirmed or dismissed by a human. No automated
   geolocation "magic button".
6. **Honest, auditable output.** Every artifact records how it was produced —
   source, timestamps, parameters, imagery attribution. Proofs are auditable by
   design; hints (e.g. manipulation analysis) are labeled as hints.
7. **Free and open source.** Free APIs and local computation only; no paid keys
   required for any core feature. Users may *optionally* supply their own API keys
   to unlock extra providers (e.g. official Google imagery), never as a requirement.
8. **English UI**, international community.

## 4. The case workspace (the heart)

A directory per investigation (`~/Ozimut/cases/<case>/` by default):

```
case.json          # case metadata + entities + links (schema below, from v1)
notes.md           # free-form case notes (markdown)
media/             # source videos/photos/audio + download/import metadata
proofs/            # composed proofs: exported PNGs + their editable JSON specs
exports/           # post drafts, reports, shared bundles
evidence.jsonl     # append-only journal: sha256, timestamp, source, action (v3)
frames/ panoramas/ satellite/ ...   # per-tool artifact folders, added as tools ship
```

Rules:

- **Every tool reads and writes here.** A proof spec saved once reopens for
  re-editing. A downloaded video is immediately available to every other tool.
- **One-shot mode** = a scratch case in a temp/inbox location. Same code path; the
  user can promote it to a named case or let it be cleaned up.
- **Plain files first.** No database server; SQLite only for local indexes/caches
  that can be rebuilt from the files.

## 5. Data model — entities & links (foundation from v1)

The entity model is the backbone of the workbench, so the **schema exists from
v1** even though the rich UI (graph, map, timeline views) arrives later. This
avoids painful migrations and lets early tools file their outputs correctly.

> Full vocabulary — entity types, per-type attribute schemas, the link registry
> (incl. the `derived-from` chain), provenance/confidence/`same-as` rules — lives
> in the versioned [**ONTOLOGY.md**](ONTOLOGY.md). This section stays a summary.

**Entity types** (extensible): `person`, `organization`, `alias/username`,
`account` (X, Telegram, VK, …), `email`, `phone`, `domain`, `ip`, `vehicle`,
`place`, `event`, `media` (photo/video/audio/document), `proof`.

**Links**: typed, directed edges between entities (`owns`, `appears-in`,
`located-at`, `same-as`, `posted`, `mentions`, …) — plus free-typed labels.

**Every entity and link carries provenance**: which tool or manual action created
it, from which source, when, with what confidence (`confirmed` by analyst vs
`suggested` by a tool).

Sketch (in `case.json`):

```jsonc
{
  "entities": [
    { "id": "e12", "type": "media", "label": "strike_video.mp4",
      "attrs": { "path": "media/strike_video.mp4", "sha256": "…", "source_url": "…" },
      "provenance": { "by": "media-library", "at": "2026-07-08T14:02:11Z", "status": "confirmed" } }
  ],
  "links": [
    { "from": "e12", "to": "e7", "type": "located-at",
      "provenance": { "by": "proof-composer", "at": "…", "status": "confirmed" } }
  ]
}
```

**Enrichment loop** (grows version by version): a tool runs → it emits suggested
entities/links → the analyst confirms or dismisses → the case graph grows. The
analyst never re-types information a tool already produced — but nothing enters
the case without a human click (principle 5).

UI progression: v1 shows entities as a simple sidebar list; v3 adds the Relations
view (select an entity → see its accounts, media, places, people), graph, map and
timeline views.

## 6. Tools by version

Phasing rule: each version must deliver **one complete workflow people will use
daily**, not a spread of half-tools. The case workspace and entity schema underpin
all of them from day one.

### v1 — Proof Studio (media → annotated proof → publishable post)

The workflow nothing else provides end-to-end, and the GeoConfirmed daily gesture:
get media in, annotate the match, publish the proof.

| Tab | What it does |
|-----|--------------|
| **Media Library** | The case's media shelf. Import local files (drag & drop) or download by URL (X, Telegram, TikTok, YouTube, … via yt-dlp) → clean local file + metadata JSON + sha256. Every media becomes a `media` entity. A **facet bar** groups the shelf on the fly — auto **type/source facets** (Images, Videos, Collages, Imports, Downloads, Other, derived from `kind` + `source`) alongside the user's **virtual folders**. Items can be assigned a **virtual folder** (stored in sidecar) and annotated with **notes**; an info modal surfaces full provenance (source URL, title, uploader, duration) + editable notes + folder; images show a **lightbox** on click. |
| **Inspect** | A scratch workspace over any photo/video — **nothing enters the case until Save**. **Selection** (video): scrub, step, scan *sharpest* frames, capture into a transient tray; a gear tunes the whole clip (brightness…) for an optional enhanced-video export. **Frame**: per-frame brightness/contrast/saturation/gamma/sharpness/grayscale/invert/rotate + interactive **crop** (applied live in the preview + tray thumbnails, still re-croppable), with a fold-out **Analyze** (histogram, EXIF, ELA *hint*). **Collage**: **multiple collages per session** (tab strip to add/switch/delete). Per piece: drag, **uniform-scale**/**rotate** (a compact toolbar floats above the piece, off the image, or panel ±/↺↻), **corner-warp**, **Front/Back** ordering, **Delete** key, and **per-piece crop** (editor over the piece's snapshot, baked before the warp — the piece's quad is re-projected to the crop so proportions stay correct and it stays in place). Tray frames (thumbnails show each frame's current adjustments) compose on a full-bleed scratch surface into a hand-made panorama. Each collage exports as a **transparent PNG of just its pieces, auto-trimmed to their bounds** — no manual canvas size. Auto-stitch = later. **Save**: tick which of {enhanced video, adjusted frames, each collage} to file — each re-derived full-res on the backend with provenance back to its source, into an optional folder; every collage shows a **true-to-export composited miniature** (the real backend warp, on a transparency checker) in the picker. Frames captured from a tuned clip inherit its look; collage pieces are **frozen snapshots** taken when added. The whole workspace can be **saved as a reopenable session** (`inspect-session` entity, spec in `inspect/`) — reload it later from the sidebar with every frame/adjustment/collage (all of them) intact; re-saving a reopened session **overwrites it in place** (even after a rename). Adjust/analysis controls come from self-describing filter/analysis registries. |
| **Satellite** | Enter/click coordinates, then **Save place** (a navigable `place` — coordinates only, no image, clickable to fly back) **or Capture** (a sourced imagery crop → `capture` image entity). Capture options: **marker style** (crosshair / Google-Maps pin / none) baked in, crop-size + **capture-frame outline** (previewed on hover, capture-only), **map rotation** (off-north; capture matches the on-screen heading, bearing in provenance). **Move-pin mode** decouples the marker from center — drag it anywhere in frame (e.g. bottom of shot) and the **recorded coordinates follow the pin** for both actions. Captures are images (open to view, not map-navigable); places are the clickable points. The tool's side panel lists both in **collapsible** sections — **Places** (fly the map back) and **Captures** (open the full image) — each with an inline **title + note editor**; the case sidebar's info panel is the same editor for any capture/place/media. Provenance (provider, zoom, date, bearing, marker, center) recorded — feeds the composer. XYZ tile-provider abstraction (see note below). Editable title + notes per capture. |
| **Proof Composer** | The heart of v1. Compose panels in a **multi-row grid** (frames, photos, satellite crops, imported screenshots) — arrange side by side *and* stack rows (↑↓ per panel) so the composite stays near-square instead of a wide bandeau. Each panel can be **resized** (± per panel, 40–250%) — its drawn elements scale with it, and shorter panels bottom-align in their row. A toggleable **tweet-crop guide** (16:9 / 4:5) dims whatever X would centre-crop; a **magic tweet-fit** button auto-repacks the panels into rows to land closest to the active guide's aspect (16:9 default) and resets panel sizes. Draw colored boxes/ellipses/lines/arrows, multi-point **curves** (rounded, click points + double-click to finish) and **text labels** with the mouse — same color = same feature across panels. Every element stays **editable after placing**: boxes/ellipses/text via transformer handles (text corner-drag = font size), lines/arrows/curves via draggable per-vertex handles; selecting an element lets you change its **color and stroke/font size live**, **copy/paste/duplicate** it (Ctrl+C/V/D, cascading offset), and **drag it onto any panel** (it re-binds to whatever panel it's dropped over). Palette presets **+ custom color picker**. Legend **annotations are written per color** (one note per feature) and auto-flow into up to 3 columns; a separate **element list** (id + kind) selects/copies/deletes individual shapes. Optional per-panel captions (**off by default** except satellite crops). A **Coordinates + Source** header (above the panels) auto-fills from them: coordinates from the first satellite panel (falls back to the next if it's deleted), source **traced through the derivation chain** back to the downloaded original (a collage/frame from a video resolves to that video's link) — a source is **always a link**, so a disk-uploaded file counts as none; both are editable and flag a **!** while empty. These carry into the **Post Composer** (on *To Post* export or when attaching the proof there). An **Advanced** panel exposes the trickier knobs: independent **caption / legend / footer font sizes** and an **editable footer** (blank = automatic imagery/source attribution). Numbered feature legend; export `proof.png` + re-editable JSON spec (`notes` per color, panel `row`/`scale`, `coords`/`coordsText`, `source`, `caption/legend/footerSize`, `footer`) saved in `proofs/`. |
| **Post Composer** | Build a GeoConfirmed-style thread from a proof. Tweet 1 = `Place - Plus code`, description, decimal coordinates (6 digits), `@GeoConfirmed` mention, source. Tweet 2 = optional media (Video / Image(s), removable), with media picked from the case library. Add extra context tweets; per-tweet character count; copy-per-tweet or copy-all. **Save drafts** (in `exports/`, reopenable from the sidebar as `post` entities) and **Publish** (copies the thread and opens X compose prefilled). Copy-paste ready — Ozimut never posts on your behalf. |
| **Case sidebar** | Always visible, three sections. **Case Notes** (`notes.md`). **Saved work** — every artifact, auto-grouped by the tool that produced it (Media Library / Inspect / Satellite / Proof Composer / Post Composer, from `provenance.by`); suggested entities pinned on top to confirm/dismiss; deleting here removes the item **everywhere** (drops its file — danger confirm). **My work** — the analyst's own **nested folders** (`/`-separated, e.g. `Sources/Telegram`), empty until you **drag** items in from Saved work; an item filed here stays in Saved work too (lives in both); deleting here only **unfiles** it (light confirm), and removing a folder cascades its subtree back to Saved work. Styled confirm dialogs, not browser popups. Create/open/promote/**rename**/**delete** cases from the switcher — names must be **unique** (case-insensitive, enforced on create/rename/promote); delete wipes the **whole case folder** and everything in it, gated behind typing `DELETE` in uppercase. |

v1 notes:

- **Tile providers**: the Satellite tool is a thin UI over an XYZ tile-source
  abstraction (URL template `{x}/{y}/{z}`, Web Mercator math, tile stitching with
  bounded concurrency, per-tile error handling, provenance recorded per crop).
  Default provider: **Esri World Imagery** (key-less, attribution required).
  **Legal-only policy**: built-in presets are exclusively providers whose terms
  permit this use (Esri; later Sentinel-2, OSM). More imagery comes from official
  APIs with the user's own key (e.g. Google Map Tiles API), configured in
  settings. Unofficial key-less endpoints of keyed services (e.g.
  `mt1.google.com`) are **never** shipped, suggested, or documented — Ozimut will
  be used by many people and must not carry that risk for them. Custom XYZ
  templates remain supported for legitimate sources (self-hosted or licensed tile
  servers).
- The composer also accepts **imported screenshots** (Google Earth, historical
  imagery, …) with a source/attribution field — built-in fetch and manual import
  coexist.
- **Delete/edit sync is two-way**: an artifact and its sidebar entity are one
  thing. Deleting a media / satellite capture / proof / post in its tool removes
  the matching entity, and deleting the entity in the sidebar removes the
  underlying file(s). One satellite capture ⇄ one `capture` entity (tied by file
  path): the entity title defaults to the coordinates but is editable, and
  deleting either side removes the other. A `place` is coordinates only — no file.
- The previous frame-geolocator engine is **not** reused; v1 is a fresh,
  minimal implementation. Frame extraction and image adjustments ship in the
  **Inspect** tab (above); v1 also lets you bring images (screenshots/exports)
  into the composer directly.

### v2 — the GEOINT suite

| Tab | What it does |
|-----|--------------|
| **Frame Extractor** | *Shipped early inside **Inspect** (§ v1)* — video scrubber, sharpest-frame suggestions, one-click capture into the case and composer. |
| **Satellite Compare** | Same coordinates across providers (Esri / Sentinel-2 with date slider / Bing / user-keyed providers), synchronized pan/zoom — imagery history and provider comparison. Builds on the v1 tile abstraction. |
| **Image Compare** | Overlay two images with opacity/swipe slider + pixel difference — frame vs satellite, or two imagery dates. |
| **Coordinates** | Convert DMS/decimal/MGRS/plus code/geohash; reverse geocode (Nominatim); quick-open links to Google Maps/Yandex/Bing/OSM. |
| **EXIF & Metadata** | Photos and videos: GPS, timestamps, device, codecs — parsed locally, with a "what was stripped" hint. Suggests `place`/`event` entities. |
| **Shadow Clock** | Mark a shadow on a photo, get possible capture times for given coordinates and date range (sun-position math, local). |
| **Reverse Search Launcher** | *Entry point in **Media Library**.* Any image/frame → reverse-search links for Google/Yandex/Bing/TinEye (opens browser tabs; no scraping). First orchestrator-pattern tool. Twist beyond plain links: an **age/origin hint** — surface the *oldest* dates the engines expose for a match so the analyst can spot recycled/old imagery and trace toward the original source. Analyst files what they pick as entities with provenance; no automated verdict. |
| **OCR** | Read signs/plates on a frame (tesseract), detect script/language. Suggests entities. |
| **Ground Imagery** | See ground-level photos around a coordinate. **Key-less open sources first** — Panoramax, Mapillary, KartaView — so it works for everyone (principle 7). **Street View**: a zero-config **easy link** (`google.com/maps?layer=c`) ships first; an optional user-keyed in-app view is gated by the settings usage counter. Picked shots file as sourced `media`/`capture` entities with provenance. |
| **Panorama** | Stitch a video time window (or a set of frames) into one wide view — `cv2.Stitcher` with fallbacks. **Pulled early into Inspect** (like Frame Extractor): an **auto-stitch** button on the collage that complements the existing hand-made warp collage — machine stitch first, hand-tune after. |

### v3 — the investigation layer (entities take the front seat)

| Tab | What it does |
|-----|--------------|
| **Case Board / Relations** | The entity UI: browse, create, merge entities; typed links; **graph, timeline and map views** over the schema that has been filling up since v1. Select a person → see their accounts, media, places, connections. |
| **Map Board (MyMaps-style)** | An interactive, editable case map: drop **custom pins** (icon/color) with **notes + links**, draw shapes, group into layers; save/reopen as a case artifact; **import & export KML/KMZ/GeoJSON** to round-trip with Google Earth/MyMaps. Pins bind to `place` entities — the case's map view, exportable and handable to someone else. |
| **Evidence Locker** | Every piece of evidence: sha256, timestamps, source URL, notes; one-click Wayback Machine archiving; exportable chain-of-custody log (`evidence.jsonl`). |
| **Timeline Builder** | Timestamped events from mixed sources aligned on an interactive timeline + map. |
| **Report Builder** | Assemble proofs, maps, timeline extracts, entity summaries and notes into a publishable HTML/PDF report. |

### v4 — orchestration & advanced

| Tab | What it does |
|-----|--------------|
| **Search Orchestrator** | The orchestrator pattern generalized: run a username/alias/email across multiple external services, collect results, analyst selects → entities with provenance. Integrations, not clones. |
| **OSM Query (Overpass)** | Form-based feature search ("water towers within 2 km of a railway") → results on map, no Overpass QL needed. |
| **Viewshed / Line of Sight** | From a point, what terrain is visible (public DEM tiles) — validate "can this ridge be seen from here?". |
| **Map Measures** | Distance, bearing/azimuth (the app's namesake), area, camera field-of-view cone on the map. |
| **Déjà Vu** | Perceptual-hash index of known/old clips — flags recycled footage. Local index first; optional community-shared index later. |
| **Manipulation Hints** | ELA (*shipped in Inspect*), JPEG quantization, noise inconsistencies — first-pass tampering indicators, honestly labeled as *hints*. |
| **Channel Monitor** | Watch Telegram channels/accounts, auto-archive media into the case, queue items for geolocation. (Needs care: rate limits, ToS.) |

### Idea backlog (unscheduled)

Loose ideas, not yet slotted into a version. Promote into a table above when a
workflow forms; delete if it stops making sense. One line each.

- **Auto-panorama in collage** — auto-stitch button in Inspect (see v2 Panorama).
- **Reverse-search + age/origin hint** in Media Library (see v2 Reverse Search).
- **Audio analyzer** — local transcription (Whisper) + sound-pattern *hint* (gunfire/engine signatures).
- **More satellite basemaps** — Sentinel-2 (date slider), OSM context, user-keyed Bing/Google (grows v2 Satellite Compare).
- **Sat-vs-screen compare** — overlay/swipe/pixel-diff alignment aid; assist, never an auto-verdict (principle 5). Grows v2 Image Compare.
- **AI-generated media detector** — a v4 Manipulation *hint*, loudly labeled, never a judgment.
- **Weather / METAR history** — corroborate a claimed date+coords (snow/clear/rain) from free archives; pairs with Shadow Clock into a chronolocation panel.
- **Measure-on-imagery** — draw a scale/distance line on a satellite capture to match feature sizes in-frame (focused v4 Map Measures slice).
- **Archive-on-download** — optional Wayback push on URL import, archive URL into provenance (early Evidence Locker slice).
- **3D satellite capture** — after MapLibre 2D parity: pitch/terrain + oblique capture (see §7).
- **A gif maker** — To visualize before / after with annotations.
- **Tools links page** — A page with many OSINT tools links.
- **Copernicus view or easy link** — A Copernicus easy links or viewer (https://browser.dataspace.copernicus.eu/).
- **Free-form montage editor** — only if a crisp boundary vs Proof Composer + Inspect collage is drawn first (else grow Inspect's collage); risk = scope-creep into a paint app.
- **Case bundle export/import** — one-click **.zip** of the whole case a recipient opens in their own Ozimut. A zip, not a hosted link (principle 1: no server).
- **Auto-translation → English** — local/offline (Whisper translate for audio; Argos/OpusMT for text): translate media titles/descriptions and audio, stored beside the original (never overwriting it). Pairs with the audio analyzer.
- _(add ideas here — keep them one-liners)_

### Explicit non-goals

- No cloud, no accounts, no hosted service, no telemetry.
- No automated geolocation "magic button" — Ozimut prepares materials and files
  facts; the analyst reasons and decides.
- No rebuilding of specialized OSINT services (email finders, people search, …) —
  orchestrate them instead (principle 4).
- No scraping features designed to evade platform blocks; the downloader uses
  yt-dlp as-is and inherits its capabilities.
- No auto-posting to any platform — Ozimut prepares posts, the human publishes.
- No paid API dependencies, ever, for core features.

## 7. Architecture

- **Backend**: Python 3.11+, FastAPI serving on `localhost`. All processing
  (ffmpeg, yt-dlp, OpenCV, pytesseract, …) runs in the backend.
- **Frontend**: web UI served by the backend, opened in the default browser
  (pywebview window revisited later). Tabs on the left, tool canvas on the right,
  case sidebar. **Svelte** + Leaflet (maps) + Konva/canvas (annotation) — decided,
  the composer's interaction state is too rich for vanilla JS.
  - **Planned map migration: Leaflet → MapLibre GL.** Phase 1 = **2D
    iso-functional parity** (same providers, same captures, zero 3D) proven by
    the existing capture tests staying green — parity asserts the *captured
    pixels*, not just that the map renders (vector-tile compositing replaces
    raster XYZ stitching). Phase 2 = pitch + terrain + oblique **3D capture**,
    with **pitch recorded in provenance** alongside bearing so a tilted crop
    stays auditable.
- **Settings & secrets**: an in-app options page manages optional API keys/secrets
  (stored locally, **never** bundled into a shared case) plus per-provider
  **monthly usage counters** so a user tracks a keyed quota (Street View, Google
  imagery, …) before hitting it. Core features never require a key (principle 7);
  key-less providers are always the default.
- **Tool navigation & derivation chain**: cleaner switching between tools, with
  linked tools surfacing their **derivation chain** (this proof ← this frame ←
  this video ← this download) as breadcrumbs — the case's connections made
  visible, an early slice of the v3 Relations view.
- **Distribution**: `pip install ozimut` + `ozimut` command for technical users;
  PyInstaller single-file executables (Windows/Linux/macOS) for everyone else.
- **Storage**: plain files as described in §4. No database server; SQLite only for
  rebuildable indexes/caches.

## 8. Milestones

1. **M0 — skeleton**: repo, FastAPI app, Svelte tab shell, case workspace CRUD +
   scratch-case flow, entity schema v1 (`case.json` read/write), packaged binary
   proven on Linux + Windows.
2. **M1 — Media Library**: import + URL download (yt-dlp), metadata + sha256,
   media entities in the sidebar.
3. **M2 — Satellite**: tile-provider abstraction, Esri crop with crosshair +
   provenance, settings for user-supplied providers/keys.
4. **M3 — Proof Composer**: panels, mouse annotation, colors, comments, legend,
   export PNG + re-editable spec. *The demo video (media → satellite → proof) is
   the community launch.*
5. **M4 — Post Composer**, v1 Proof Studio complete + deep-linkable tools.
6. **M5 — Inspect** (Frame Extractor pulled early): scratch workspace, frame
   extraction/adjustments, warp collage, reopenable sessions (M5.1 rework).
7. **M6 — polish pass** across all five tools: Media facet bar, Satellite
   places/captures split + move-pin, Proof Composer curves/text/live-editable
   elements, Post Composer proof picker, case rename/delete + unique names.
8. **M7+**: v2 GEOINT suite (auto-panorama, reverse-search — see backlog) by
   community demand, then the investigation layer.

## 9. Open questions

- License: MIT vs AGPL (AGPL deters closed-source forks of a community tool; MIT
  maximizes adoption). Leaning AGPL-3.0 — to confirm.
- Entity schema details: attribute vocabularies per type, `same-as` merge
  semantics, confidence levels — draft during M0, freeze at v1 release.
- Proof spec JSON format: design fresh at M3 (the old compose_proof format is a
  reference, not a constraint).
- Tile providers: which providers ship as presets beyond Esri (Sentinel-2 via a
  key-less WMTS? OSM for street context?); tile caching policy (cache under the
  case for reproducibility vs a shared cache).
- One-shot scratch cases: where do they live, when are they cleaned up, what does
  "promote to case" look like?
- Déjà Vu community index: needs infra + moderation; out of scope until v4.
- Name/handle availability check: GitHub org/repo `ozimut`, x.com handle, domain.
