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
| **Media Library** | The case's media shelf. Import local files (drag & drop) or download by URL (X, Telegram, TikTok, YouTube, … via yt-dlp) → clean local file + metadata JSON + sha256. Every media becomes a `media` entity. |
| **Satellite** | Enter/click coordinates: imagery crop centered on the point, crosshair marker, zoom control, provenance (provider, zoom, date, attribution) recorded — feeds the composer directly. XYZ tile-provider abstraction (see note below). |
| **Proof Composer** | The heart of v1. Compose panels side by side (frames, photos, satellite crops, imported screenshots); draw colored boxes/ellipses/lines/arrows with the mouse — same color = same feature across panels; per-shape and per-panel **comments/captions**; numbered feature legend; layout rows; export `proof.png` + re-editable JSON spec saved in `proofs/`. |
| **Post Composer** | Turn a proof into a publishable post, GeoConfirmed-style: coordinates in multiple formats, plus code, place name, imagery attribution, source credit, character count, thread splitting. Copy-paste ready — Ozimut never posts on your behalf. |
| **Case sidebar** | Always visible: case notes (`notes.md`), media list, saved proofs, entity list (simple list view). Create/open/promote cases. |

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
- The previous frame-geolocator engine is **not** reused; v1 is a fresh,
  minimal implementation. Frame extraction from video is v2; in v1 you bring
  images (screenshots/exports) into the composer.

### v2 — the GEOINT suite

| Tab | What it does |
|-----|--------------|
| **Frame Extractor** | Drop a video: timeline scrubber, auto-suggested sharpest frames per time bin, one-click capture → frames land in the case and the composer. |
| **Satellite Compare** | Same coordinates across providers (Esri / Sentinel-2 with date slider / Bing / user-keyed providers), synchronized pan/zoom — imagery history and provider comparison. Builds on the v1 tile abstraction. |
| **Image Compare** | Overlay two images with opacity/swipe slider + pixel difference — frame vs satellite, or two imagery dates. |
| **Coordinates** | Convert DMS/decimal/MGRS/plus code/geohash; reverse geocode (Nominatim); quick-open links to Google Maps/Yandex/Bing/OSM. |
| **EXIF & Metadata** | Photos and videos: GPS, timestamps, device, codecs — parsed locally, with a "what was stripped" hint. Suggests `place`/`event` entities. |
| **Shadow Clock** | Mark a shadow on a photo, get possible capture times for given coordinates and date range (sun-position math, local). |
| **Reverse Search Launcher** | Any image/frame → search links for Google/Yandex/Bing/TinEye (opens browser tabs; no scraping). First orchestrator-pattern tool. |
| **OCR** | Read signs/plates on a frame (tesseract), detect script/language. Suggests entities. |
| **Panorama** | Stitch a video time window into one wide view (cv2.Stitcher with fallbacks). |

### v3 — the investigation layer (entities take the front seat)

| Tab | What it does |
|-----|--------------|
| **Case Board / Relations** | The entity UI: browse, create, merge entities; typed links; **graph, timeline and map views** over the schema that has been filling up since v1. Select a person → see their accounts, media, places, connections. |
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
| **Manipulation Hints** | ELA, JPEG quantization, noise inconsistencies — first-pass tampering indicators, honestly labeled as *hints*. |
| **Channel Monitor** | Watch Telegram channels/accounts, auto-archive media into the case, queue items for geolocation. (Needs care: rate limits, ToS.) |

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
5. **M4 — Post Composer + polish**, first public release (GitHub + X post).
6. **M5+**: v2 GEOINT suite by community demand, then the investigation layer.

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
