# Azimut — the OSINT investigator's workbench

> One case, one folder, every tool. Local-first: your media and your investigations
> never leave your machine. Built for the open-source-investigation community
> (GeoConfirmed contributors, journalists, researchers).

Status: **draft spec v0.2** (2026-07-08) — supersedes v0.1, which framed Azimut as a
collection of geolocation tools. v0.2 reframes it around a single story. Everything
here is open to change.

---

## 1. The story (read this first)

Azimut is **not** a geolocation app, and it is **not** a Maltego competitor.

Azimut is **the desk where an OSINT investigation lives**. GEOINT (geolocation
proofs) is its flagship pillar and the v1 focus, but every facet of an
investigation — media, people, places, timelines, evidence, reports — belongs in
the same case.

Today an investigation is scattered across 50 browser tabs, three Windows folders,
Obsidian, Draw.io, Google Earth, a paint program and a notepad. Azimut replaces
that mess with one promise:

> **Close Azimut. Reopen the case six months later. Everything is there:**
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

Azimut bundles the daily gestures into one installable app and ties their outputs
into a case, with a simple guarantee: **everything runs on your machine.**

## 3. Principles

1. **Local-first, privacy-first.** No account, no telemetry, no upload. Network is
   used only when a tool inherently needs it (map tiles, geocoding, media download)
   and always to third parties directly — never through an Azimut server.
2. **The case is the product.** Tools are how you work; the case folder is what you
   keep. Plain files (JSON + media), human-readable, versionable, portable.
3. **One tab = one tool, useful in 30 seconds.** Every tool works one-shot with no
   case open (a scratch case is created silently and can be discarded or promoted).
   Tools share data through the case, but never require ceremony.
4. **Orchestrator, not replacer.** Azimut does not rebuild specialized OSINT
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

A directory per investigation (`~/Azimut/cases/<case>/` by default):

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

Placement rule: where a tool lives on screen is set by the **workspace model**
in [UI.md](UI.md) — new tools land as tabs/modes inside an existing workspace
(Collect / Examine / Map / Compose / Case), never as new rail entries.

### v1 — Proof Studio (media → annotated proof → publishable post)

The workflow nothing else provides end-to-end, and the GeoConfirmed daily gesture:
get media in, annotate the match, publish the proof.

| Tab | What it does |
|-----|--------------|
| ✅ **Media Library** | The case's media shelf. Import local files (drag & drop) or download by URL (X, Telegram, TikTok, YouTube, … via yt-dlp, with a **gallery-dl fallback** for image-only posts yt-dlp's video-first extractors drop — photo tweets, direct image links, Instagram, Facebook photos; a small **Telegram photo scraper** additionally fills in photos on mixed video+photo albums, which yt-dlp's Telegram extractor silently ignores) → clean local file + metadata JSON + sha256, with a **Title** field auto-filled from the extracted title. A link with several attachments (e.g. a tweet with multiple photos/a video) opens a **picker** to choose which ones to fetch, each with its own editable Title before download; a single-item link downloads straight away as before. Every media becomes a `media` entity. A **facet bar** groups the shelf on the fly — auto **type/source facets** (Images, Videos, Collages, Imports, Downloads, Other, derived from `kind` + `source`) alongside the user's **virtual folders**. Items can be assigned a **virtual folder** (stored in sidecar) and annotated with **notes**; an info modal surfaces full provenance (source URL, title, uploader, duration) + editable notes + folder; images show a **lightbox** on click. |
| ✅ **Inspect** | A scratch workspace over any photo/video — **nothing enters the case until Save**. **Selection** (video): scrub, step, scan *sharpest* frames, capture into a transient tray; a gear tunes the whole clip (brightness…) for an optional enhanced-video export. **Frame**: per-frame brightness/contrast/saturation/gamma/sharpness/grayscale/invert, a **view-only zoom/pan/rotate** viewer (never saved — middle-drag turns the image around the grabbed point, marked by a "target", Google-Earth style; composes over any prior zoom/pan/rotate), and an **editable crop** — draw or nudge its 8 handles, **aspect-lock presets + numeric px entry**, **Enter/Apply** commits to a cropped preview, re-open (button or **double-click**) to edit the original — with a fold-out **Analyze** (histogram, EXIF, ELA *hint*). **Collage**: **multiple collages per session** (tab strip to add/switch/delete). Per piece: drag, **round corner handles warp**, **square side handles uniform-scale** (composes with the warp, holds up on an already-warped piece), a **rotate knob** on a stem that **follows the piece**; a small top bar carries only the **ghost** preview + **±1 stacking**, while the right panel keeps precise scale/rotate (±/↺↻) and all-the-way **Front/Back**; **Delete** removes it. **Shift-click selects several pieces**: a dashed **block frame** then moves / corner-scales / rotates them as one rigid unit about the block's centre (right panel mirrors it with precise ±/↺↻ + bulk remove), a plain click collapses back to one, and **Delete** clears the block. **Per-piece crop** is the same editable box (handles, aspect lock, numeric) over the piece's snapshot, baked before the warp — the quad is re-projected to the crop so proportions stay correct and it stays in place. Tray frames (thumbnails show each frame's current adjustments) compose on a full-bleed scratch surface into a hand-made panorama. Each collage exports as a **transparent PNG of just its pieces, auto-trimmed to their bounds** — no manual canvas size. Auto-stitch = later. **Save**: tick which of {enhanced video, adjusted frames, each collage} to file — each re-derived full-res on the backend with provenance back to its source, into an optional folder; every collage shows a **true-to-export composited miniature** (the real backend warp, on a transparency checker) in the picker. Frames captured from a tuned clip inherit its look; collage pieces are **frozen snapshots** taken when added. The whole workspace can be **saved as a reopenable session** (`inspect-session` entity, spec in `inspect/`) — reload it later from the sidebar with every frame/adjustment/collage (all of them) intact; re-saving a reopened session **overwrites it in place** (even after a rename). Adjust/analysis controls come from self-describing filter/analysis registries. |
| ✅ **Satellite** | Enter/click coordinates, then **Save place** (a navigable `place` — coordinates only, no image, clickable to fly back) **or Capture** (a sourced imagery crop → `capture` image entity, **filed in `media/`** so it also lists in the Media Library and opens in Inspect). A single **split capture button** re-runs whichever mode was used last — **Capture** for a centred **standard size** (Tweet 16:9 / Square / OG card / Wide / custom), or **Select area**, which arms a **mouse marquee** to drag a rectangle (live px/dimension readout) for an optional **ratio lock** (16:9 / 4:3 / 1:1 / free) — with its arrow opening a compact **mode/size/ratio/resolution popover** (closes on outside click) and a **resolution** control (1× / 2× / provider max-zoom, sized so 2×/max always yield a sharper file on every built-in preset) that captures a deeper zoom. **Marker style** (crosshair / Google-Maps pin / none) baked in; centred-Capture **frame outline** previewed on hover. **Map rotation** — **middle-drag turns the map around the grabbed point** (sober target marker, Google-Earth style), click the bearing to **type an exact angle**, click the compass rose to reset north (capture matches the on-screen heading, bearing in provenance). **Move-pin mode** decouples the marker from center — drag it anywhere in frame (e.g. bottom of shot) and the **recorded coordinates follow the pin** for both actions. **Two dates per capture**: the **capture timestamp** and the **imagery acquisition date** (Esri best-effort, if known) — both recorded and shown. **Map workspace**: toggle an **OSM labels overlay** (roads / place names over the imagery — disabled over a street base map, where it'd only double the labels), read the imagery acquisition date under the crosshair (shown as an unobtrusive corner pill), go **true browser fullscreen** (dialogs follow the map in, and actions that would leave it — another tool, another tab — grey out), **measure** distance / area / **angle** (reported as the acute + obtuse pair), and float **reference windows** over the map (pick any case **image or video**; drag / roll-up / resize — images wheel-zoom & pan, videos get a native player) to eyeball the shot you're geolocating against the imagery — a **session-only scratch aid, never captured or saved**. The tool's side panel lists both in **collapsible** sections — **Places** (fly the map back) and **Captures** (open the full image, or **go to** their coordinates — also from the case sidebar) — each with an inline **title + note editor**; the case sidebar's info panel is the same editor for any capture/place/media. A collapsible **Open in…** list jumps to external maps we can't embed (Google/Earth, Apple, Bing, Yandex, Satellites.pro, Copernicus, Zoom Earth) at the current target. Provenance (provider, zoom, both dates, bearing, marker, center) recorded — feeds the composer. XYZ tile-provider abstraction (see note below). Editable title + notes per capture. |
| ✅ **Proof Composer** | The heart of v1. Compose panels in a **multi-row grid** (frames, photos, satellite crops, imported screenshots) — arrange side by side *and* stack rows (select a panel — canvas click or side list — and move it with **on-canvas arrows**) so the composite stays near-square instead of a wide bandeau. Each panel can be **resized** (corner-drag the selected panel, or ± in the side list; 40–250%) — its drawn elements scale with it, and shorter panels bottom-align in their row. A grid/free **mode switcher** can drop the grid for a **free layout**: **drag panels anywhere** (their elements follow), **overlap allowed** with array order as **z-order** (front/back per panel), select a panel to **corner-drag resize** it (aspect locked, no rotation); saved per proof, magic tweet-fit snaps back to the grid. A toggleable **tweet-crop guide** (16:9 / 4:5) dims whatever X would centre-crop; a **magic tweet-fit** button auto-repacks the panels into rows to land closest to the active guide's aspect (16:9 default) and resets panel sizes. Draw colored boxes/ellipses/lines/arrows, multi-point **curves** (rounded, click points + double-click to finish) and **text labels** (optional **frame and/or background box**, from the Elements tab) with the mouse — same color = same feature across panels. Every element stays **editable after placing**: boxes/ellipses/text via transformer handles (text corner-drag = font size), lines/arrows/curves via draggable per-vertex handles; selecting an element lets you change its **color and stroke/font size live**, **copy/paste/duplicate** it (Ctrl+C/V/D, cascading offset), and **drag it onto any panel** (it re-binds to whatever panel it's dropped over). Palette presets **+ custom color picker**. Legend **annotations are written per color** (one note per feature), **manually reorderable** from the Annotations tab, and auto-flow into up to 3 columns; a separate **element list** (id + kind) selects/copies/deletes/**reorders** individual shapes (order = z-order within their panel). Optional per-panel captions (**off by default**; a satellite crop auto-captions with provider · coordinates · **imagery acquisition date** — the date omitted when unknown, never the fetch date). A **Coordinates + Source** header (above the panels) auto-fills from them: coordinates from the first satellite panel (falls back to the next if it's deleted), source **traced through the derivation chain** back to the downloaded original (a collage/frame from a video resolves to that video's link) — a source is **always a link**, so a disk-uploaded file counts as none; both are editable and flag a **!** while empty. These carry into the **Post Composer** (on *To Post* export or when attaching the proof there). An **Advanced** panel exposes the trickier knobs: independent **caption / legend / footer font sizes** and an **editable footer** (blank = automatic imagery/source attribution). Feature legend (color dot only, numbered in the Annotations tab for reference); export `proof.png` + re-editable JSON spec (`notes`/`legendOrder` per color, `layout`, panel `row`/`scale`/`x,y`, `coords`/`coordsText`, `source`, `caption/legend/footerSize`, `footer`) saved in `proofs/`. |
| ✅ **Post Composer** | Build a GeoConfirmed-style thread from a proof. Tweet 1 = `Place - Plus code`, description, decimal coordinates (6 digits), `@GeoConfirmed` mention, source. Tweet 2 = optional media (Video / Image(s), removable), with media picked from the case library. Add extra context tweets; per-tweet character count; copy-per-tweet or copy-all. **Save drafts** (in `exports/`, reopenable from the sidebar as `post` entities) and **Publish** (copies the thread and opens X compose prefilled). Copy-paste ready — Azimut never posts on your behalf. |
| ✅ **Case sidebar** | Always visible. **Case Notes** (`notes.md`). **Suggestions** — tool-suggested entities, confirm or dismiss. **My work** — every saved artifact under the analyst's own **nested folders** (`/`-separated, e.g. `Sources/Telegram`) plus an **Unfiled** inbox; file items by **dragging onto a folder** or from the **details panel** (folder field); unfiling deletes nothing, removing a folder just unfiles its subtree. **Details panel** — selection editor for any artifact: preview, title/notes, provenance (created by/at, source), My-work folder, open-in-tool / open-file / go-to-coords, and **Delete everywhere** (drops the file — danger confirm). Saved artifacts are reopened **in their tools** (Open lists in Proof/Post/Inspect — each row deletable — plus the Media & Satellite shelves); the sidebar no longer duplicates a by-tool listing. Styled confirm dialogs, not browser popups. Create/open/promote/**rename**/**delete** cases from the switcher — names must be **unique** (case-insensitive, enforced on create/rename/promote); delete wipes the **whole case folder** and everything in it, gated behind typing `DELETE` in uppercase. |

v1 notes:

- **Tile providers**: the Satellite tool is a thin UI over an XYZ tile-source
  abstraction (URL template `{x}/{y}/{z}`, Web Mercator math, tile stitching with
  bounded concurrency, per-tile error handling, provenance recorded per crop).
  Default provider: **Esri World Imagery** (key-less, attribution required).
  **Legal-only policy**: built-in presets are exclusively providers whose terms
  permit this use (Esri; later Sentinel-2, OSM). More imagery comes from official
  APIs with the user's own key (e.g. Google Map Tiles API), configured in
  settings. Unofficial key-less endpoints of keyed services (e.g.
  `mt1.google.com`) are **never** shipped, suggested, or documented — Azimut will
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
  path): a capture is filed through the **media pipeline** (lives in `media/`,
  hashed + thumbnailed, shown in the Media Library, openable in Inspect) but under
  a `capture` entity — not `media` — carrying its coordinates; its media sidecar's
  `source.type == "satellite"` is what tells the two apart. Captures never dedupe
  (1:1 with their entity). The entity title defaults to the coordinates but is
  editable, and deleting either side removes the other. A `place` is coordinates
  only — no file.
- The previous frame-geolocator engine is **not** reused; v1 is a fresh,
  minimal implementation. Frame extraction and image adjustments ship in the
  **Inspect** tab (above); v1 also lets you bring images (screenshots/exports)
  into the composer directly.

### v2 — the GEOINT suite

| Tab | What it does |
|-----|--------------|
| ✅ **Frame Extractor** | *Shipped early inside **Inspect** (§ v1)* — video scrubber, sharpest-frame suggestions, one-click capture into the case and composer. |
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

### Idea backlog (grouped by likely version)

Loose ideas, sorted by the version they'd most likely land in — a rough order,
not a commitment. Promote into a table above when a workflow firms up; delete if
it stops making sense. One line each.

**Toward v2 (GEOINT suite) — mostly grow existing v2 tools:**
- **More satellite basemaps** — Sentinel-2 (date slider), user-keyed Bing (grows Satellite Compare). **OSM context** ✅. User-keyed **Mapbox & Google** basemaps + API-keys settings tab + monthly usage counters ✅ — their legal rules, costs and quirks are in [IMAGERY_PROVIDERS.md](IMAGERY_PROVIDERS.md).
- **Keyed-provider cost controls** ✅ — per-provider enable/disable toggles; usage/limits page links in Settings; soft-block keyed maps at 90% of the free tier (clear message, explicit override); eco mode: auto-switch to free imagery when zoomed out (configurable, default z ≤ 15); Google hi-DPI 1024px tiles (1/16-cost captures; live map oversampled 2× — crisp mid-zoom imagery at ¼ cost); Mapbox/Esri disk tile cache (respect `cacheable`).
- **Esri overzoom** ✅ — where World Imagery ends, upscale the parent tile instead of showing Esri's "not yet available" placeholder (live map + capture engine, noted in provenance).
- **Capture extension** — browser extension (MV3): screenshot the active map (Google Earth/Maps, …), parse coords/zoom from the URL, file into Azimut via a local ingest endpoint with provenance (ToS: user-initiated screenshot, attribution kept).
- **Copernicus easy link / viewer** — quick link into `browser.dataspace.copernicus.eu` (grows Satellite Compare).
- **Sat-vs-screen compare** — overlay/swipe/pixel-diff alignment aid; assist, never an auto-verdict (principle 5). Grows Image Compare.
- **Weather / METAR history** — corroborate a claimed date+coords from free archives; pairs with Shadow Clock into a chronolocation panel.
- **GIF maker** — before/after with annotations.
- **Tools links page** — a page of curated OSINT tool links.
- **Command palette** (Ctrl+K) — every tool/action one keystroke away, once the v2 tabs multiply.

**Toward v3 (investigation layer):**
- **Dependency-aware delete** — deleting a media that proofs/sessions/posts derive from: never cascade; confirm dialog lists dependents (needs real `derived-from` links written at save time); dependents keep a provenance tombstone (sha256 + source URL); Inspect opens missing sources as placeholders.
- **Archive-on-download** — optional Wayback push on URL import, archive URL into provenance (early Evidence Locker slice).
- **Extension for saving a web page** — web extension for saving a web page.
- **Case bundle export/import** — one-click **.zip** of the whole case a recipient opens in their own workbench; a zip, not a hosted link (principle 1).
- **Proof Composer free overlay layer** — **image as a first-class free element** (paste/drop, move/resize, floats or anchors to a panel) — must survive magic tweet-fit; carries the imported-screenshot source field (principle 6).
- **Callout / detail inset** — image-as-element wired to a circled feature by a color-matched arrow; optional **smart connector** that reflows when either end moves.
- **Audio analyzer** — local transcription (Whisper) + sound-pattern *hint* (gunfire/engine signatures).
- **Auto-translation → English** — local/offline (Whisper translate; Argos/OpusMT) for titles/descriptions/audio, stored beside the original. Pairs with the audio analyzer.

**Toward v4 (orchestration & advanced):**
- **AI-generated media detector** — a Manipulation *hint*, loudly labeled, never a judgment.
- **Measure-on-imagery** — draw a scale/distance line on a satellite capture to match feature sizes in-frame (focused Map Measures slice).

**After the MapLibre migration (§7):**
- **3D satellite capture** — pitch/terrain + oblique capture, pitch recorded in provenance.
- **Google Photorealistic 3D Tiles** — user-keyed 3D mesh basemap; needs a WebGL engine, and a 3D scene is not a flat capture.

**Unscheduled / undecided:**
- **Free-form montage editor** — likely unneeded once the free overlay layer lands; only with a crisp boundary vs Proof Composer + Inspect collage (risk = paint-app scope-creep).
- _(add ideas here — keep them one-liners)_

### Explicit non-goals

- No cloud, no accounts, no hosted service, no telemetry.
- No automated geolocation "magic button" — Azimut prepares materials and files
  facts; the analyst reasons and decides.
- No rebuilding of specialized OSINT services (email finders, people search, …) —
  orchestrate them instead (principle 4).
- No scraping features designed to evade platform blocks; downloads use
  yt-dlp and gallery-dl as-is and inherit their capabilities.
- No auto-posting to any platform — Azimut prepares posts, the human publishes.
- No paid API dependencies, ever, for core features.

## 7. Architecture

- **Backend**: Python 3.11+, FastAPI serving on `localhost`. All processing
  (ffmpeg, yt-dlp, gallery-dl, OpenCV, pytesseract, …) runs in the backend.
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
- ✅ **Settings & secrets**: an in-app options page manages optional API keys/secrets
  (stored locally, **never** bundled into a shared case) plus per-provider
  **monthly usage counters** so a user tracks a keyed quota (Street View, Google
  imagery, …) before hitting it. Core features never require a key (principle 7);
  key-less providers are always the default.
- **UI direction & workspaces**: the rail holds a fixed set of workspaces in
  investigation-pipeline order; tools are tabs/modes inside them; visual
  language is the sober "pro desk" (dense, flat, one accent), not the AI
  dashboard — direction, tables and rollout in [UI.md](UI.md).
- **Tool navigation & derivation chain**: cleaner switching between tools, with
  linked tools surfacing their **derivation chain** (this proof ← this frame ←
  this video ← this download) as breadcrumbs — the case's connections made
  visible, an early slice of the v3 Relations view.
- **Distribution**: `pip install azimut` + `azimut` command for technical users;
  PyInstaller single-file executables (Windows/Linux/macOS) for everyone else.
- **Storage**: plain files as described in §4. No database server; SQLite only for
  rebuildable indexes/caches.

## 8. Milestones

1. ✅ **M0 — skeleton**: repo, FastAPI app, Svelte tab shell, case workspace CRUD +
   scratch-case flow, entity schema v1 (`case.json` read/write).
2. ✅ **M1 — Media Library**: import + URL download (yt-dlp), metadata + sha256,
   media entities in the sidebar.
3. ✅ **M2 — Satellite**: tile-provider abstraction, Esri crop with crosshair +
   provenance, settings for user-supplied providers/keys.
4. ✅ **M3 — Proof Composer**: panels, mouse annotation, colors, comments, legend,
   export PNG + re-editable spec. *The demo video (media → satellite → proof) is
   the community launch.*
5. ✅ **M4 — Post Composer**, v1 Proof Studio complete + deep-linkable tools.
6. ✅ **M5 — Inspect** (Frame Extractor pulled early): scratch workspace, frame
   extraction/adjustments, warp collage, reopenable sessions (M5.1 rework).
7. ✅ **M6 — polish pass** across all five tools: Media facet bar, Satellite
   places/captures split + move-pin, Proof Composer curves/text/live-editable
   elements, Post Composer proof picker, case rename/delete + unique names.
8. ✅ **M7 — Launch v1**: pip-installable package (frontend bundled in the wheel),
   AGPL-3.0 `LICENSE`, cross-platform binaries via CI (Windows/Linux/macOS),
   PyPI publish, `v0.1.0` GitHub release, demo video (media → satellite → proof).
9. **M8+**: v2 GEOINT suite (auto-panorama, reverse-search — see backlog) by
   community demand, then the investigation layer.

## 9. Open questions

- **Decided: AGPL-3.0-only** ✅ (root `LICENSE` in place).
- Entity schema details: attribute vocabularies per type, `same-as` merge
  semantics, confidence levels — draft during M0, freeze at v1 release.
- Proof spec JSON format: design fresh at M3 (the old compose_proof format is a
  reference, not a constraint).
- **Decided: OSM ships for street context, and the tile cache is shared, not
  per-case** ✅ (30-day TTL under the workspace, never Google — see
  [IMAGERY_PROVIDERS.md](IMAGERY_PROVIDERS.md)). Sentinel-2 via a key-less WMTS
  stays open.
- One-shot scratch cases: where do they live, when are they cleaned up, what does
  "promote to case" look like?
- Déjà Vu community index: needs infra + moderation; out of scope until v4.
- Name/handle availability check: GitHub org/repo `azimut`, x.com handle, domain.
