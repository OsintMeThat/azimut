# Azimut — the OSINT investigator's workbench

> One case, one folder, every tool. Local-first: your media and your
> investigations never leave your machine. Built for the open-source-investigation
> community (GeoConfirmed contributors, journalists, researchers).

Status: **spec v0.3** (2026-07-18). Reads top to bottom as: the story → what
ships today (Done) → the roadmap (v2+) → loose ideas. Shipped-tool detail lives
in code + tests; imagery in [IMAGERY_PROVIDERS.md](IMAGERY_PROVIDERS.md), UI in
[UI.md](UI.md), entities in [ONTOLOGY.md](ONTOLOGY.md).

---

## 1. The story

Azimut is **the desk where an OSINT investigation lives**. GEOINT (geolocation
proofs) is the flagship pillar and the v1 focus, but media, people, places,
timelines, evidence and reports all belong in the same case.

> **Close Azimut. Reopen the case six months later. Everything is there:** the
> media, the annotated proofs, the entities and their links, the timeline, the
> notes, the exports — in one plain folder you can zip, git, or share.

Every design decision is tested against that sentence. Today an investigation is
scattered across 50 tabs, three folders, Obsidian, Draw.io, Google Earth and a
notepad; Azimut bundles the daily gestures into one installable app and files
their outputs into the case.

## 2. Principles

1. **Local-first, privacy-first.** No account, no telemetry, no upload. Network
   only when a tool inherently needs it (tiles, geocoding, download), always to
   third parties directly, never through an Azimut server. One exception: an
   opt-out check to GitHub's public releases feed on load, so binary users hear
   about updates (Settings → Updates turns it off).
2. **The case is the product.** Tools are how you work; the case folder is what
   you keep — plain JSON + media, human-readable, versionable, portable.
3. **One tab = one tool, useful in 30 seconds.** Every tool works one-shot with
   no case open (a silent scratch case, discardable or promotable).
4. **Orchestrator, not replacer.** Azimut launches specialized services and files
   what the analyst picks as entities with provenance; it never clones them.
5. **Tools emit facts, the analyst decides.** Tools suggest entities/links but
   nothing enters the case without a human click. No automated geolocation magic.
6. **Honest, auditable output.** Every artifact records how it was produced;
   hints are labeled as hints.
7. **Free and open source.** Free APIs and local computation only; user keys are
   optional extras (e.g. official Google imagery), never a requirement.
8. **English UI**, international community.

## 3. The case workspace

A directory per investigation (`~/Azimut/cases/<case>/` by default):

```
case.json      # metadata + entities + links (schema from v1)
notes.md       # free-form case notes (markdown)
media/         # source + captured + extracted media, with metadata + sha256
proofs/        # composed proofs: exported PNGs + editable JSON specs
exports/       # post drafts, reports, shared bundles
evidence.jsonl # append-only journal (v3)
inspect/       # saved Inspect session specs
```

Every tool reads and writes here. Plain files first; SQLite only for rebuildable
indexes. One-shot mode = a scratch case in a temp/inbox location, same code path,
promotable to a named case or reaped when idle.

## 4. Data model — entities & links

The schema exists from **v1** so early tools file their outputs correctly and to
avoid painful migrations. Full vocabulary in [ONTOLOGY.md](ONTOLOGY.md).

- **Entity types** (extensible): person, organization, alias/username, account,
  email, phone, domain, ip, vehicle, place, event, media, proof.
- **Links**: typed directed edges (owns, appears-in, located-at, same-as, posted,
  mentions, …) plus free-typed labels.
- **Provenance on everything**: which tool/action, source, when, confidence
  (`confirmed` by analyst vs `suggested` by a tool).

Enrichment loop: a tool runs → suggests entities/links → the analyst confirms or
dismisses → the case graph grows. UI progression: v1 a sidebar list; v3 adds the
Relations, graph, map and timeline views.

---

## 5. Done — v1 Proof Studio (shipped as GitHub `v0.1.0`)

The end-to-end daily gesture, GeoConfirmed-style: media in → annotate the match →
publish the proof. Milestones M0–M7 delivered it (AGPL-3.0, frontend bundled in
the wheel, cross-platform binaries, tag-driven release CI).

| Tool | What it does |
|------|--------------|
| ✅ **Media Library** | Case media shelf. Import (drag & drop) or download by URL (yt-dlp + gallery-dl fallback + Telegram photo scraper) → clean file + metadata + sha256, each a `media` entity. Multi-attachment picker, facet bar (type/source + virtual folders), per-item notes, lightbox, provenance modal. |
| ✅ **Inspect** | Scratch workspace over any photo/video, nothing saved until Save. Sharpest-frame scan, per-frame adjustments, view-only zoom/pan/rotate, editable crop, multi-piece warp collage with auto-stitch (planar/cylindrical/spherical), ELA hint, reopenable sessions. |
| ✅ **Satellite** | Coordinate map over an XYZ tile abstraction. Save a `place` or capture a sourced crop (→ `capture`, filed in `media/`). Standard-size or marquee capture, resolution multiplier, marker styles, map rotation, move-pin, dual dates, measure, OSM overlay, reference windows, external-map links. |
| ✅ **Proof Composer** | The v1 heart. Multi-row grid or free layout of panels; resize, tweet-crop guide, magic tweet-fit. Draw boxes/ellipses/lines/arrows/curves/text, all editable after placing; per-color legend; captions; a Coordinates + Source header traced through the derivation chain; signature. Export `proof.png` + re-editable JSON spec. |
| ✅ **Post Composer** | GeoConfirmed thread from a proof: place + plus code, decimal coords, mention, source, optional media tweet, extra tweets, char counts. Save drafts, publish (opens X prefilled — never posts for you). |
| ✅ **Case sidebar** | Resizable. Case notes, suggestions inbox, nested "My work" folders + Unfiled, a details/selection editor, two-way delete sync, and the case switcher (create/open/promote/rename/delete, unique names). |

**Also shipped** (folded in from the old backlog): Sentinel-2 (user-keyed, layer
picker + pass calendar), OpenTopoMap, OSM overlay, Google Maps JS basemap for the
EEA, Esri overzoom, keyed Mapbox/Google with monthly usage counters + eco mode +
cost controls, the capture browser extension, the settings tabs
(Preferences/Imagery/About) + settings backup, scraper self-update, the launcher,
server security hardening, and the two-regime dependency setup.

**Shipped since** (first v2 tools landed on `main`):

| Tool | What it does |
|------|--------------|
| ✅ **Coordinates** | Map-workspace tab: paste a point in any notation (decimal, DDM, DMS, UTM, MGRS, plus code, geohash) → read it back in every other with copy; the nine external-map links; opt-in Nominatim place name. |
| ✅ **Reverse Search** | Collect-workspace launcher: pick a case image (or scrub a video to a frame), tweak brightness/contrast/saturation/grayscale → copy to the clipboard for Google Lens or save the PNG to drag into Yandex/Bing/TinEye, each opened key-less. Orchestrates, never queries itself. |
| ✅ **Grid Search** | Satellite mode: overlay a custom metric grid on an area of interest — drag a box or draw a polygon, reshape either after the fact — and sweep it cell by cell. Fly-to-review with keyboard marks, cleared/flagged coverage; every action auto-saves. A case holds several named grids you switch between; promote a hit to a `place`. In-app only, no export. |

**Key constraints** (carried forward):

- **Legal-only imagery**: built-in providers are Esri (default, key-less), OSM,
  OpenTopoMap and Sentinel-2 only. Keyed providers need the user's own key.
  Unofficial key-less endpoints of keyed services (`mt1.google.com`) are never
  shipped. Custom XYZ templates stay supported.
- **Two-way delete/edit sync**: an artifact and its sidebar entity are one thing;
  deleting either removes the other. One capture ⇄ one `capture` entity.
- **Frame-geolocator engine is not reused**; v1 is a fresh implementation.

---

## 6. Roadmap

Each version must deliver **one complete workflow people use daily**, not a
spread of half-tools. Ideas that firm up get promoted into these tables (§7);
new tools land as tabs/modes inside an existing workspace (see [UI.md](UI.md)),
never as new rail entries. Releases ship as GitHub `v0.x` tags.

### v2 — GEOINT suite

| Tool | What it does |
|------|--------------|
| **Satellite Compare** | Same coords across providers (Esri / Sentinel-2 date slider / Bing / keyed), synced pan/zoom. Copernicus easy link. |
| **Image Compare** | Overlay two images with opacity/swipe + pixel diff. Sat-vs-screen alignment aid (assist, never a verdict). |
| **EXIF & Metadata** | GPS/timestamps/device/codecs parsed locally + a "what was stripped" hint; suggests place/event. |
| **Shadow Clock** | Mark a shadow → possible capture times (sun-position math, local); sun times + solar azimuth readout at coords+date. Pairs with weather/METAR history. |
| **OCR** | Read signs/plates (tesseract), detect script/language. |
| **Audio Transcript** | Transcribe speech (Whisper) + acoustic context hints (bells/adhan/aircraft/language); auto-translate → English (offline). |
| **Ground Imagery** | Ground-level photos: Panoramax/Mapillary/KartaView key-less first; Street View easy link, optional keyed in-app view. |
| **Panorama** | Stitch a video window / frame set. Auto-stitch already in Inspect; still to do: sample a video window directly, seam blending. |
| **Proof annotation** | Grow the Proof Composer toolbox: shape fill + dashed strokes, freehand, numbered markers, a redaction/blur box; a document-level free layer so shapes cross panels and reach the margins; callout / zoom insets. |
| **Case Notebook** | A full notes page, not just raw `notes.md`: write, paste screenshots and images, embed links to places/entities; a writer pane + a reader pane. |
| **Proof Templates** | Save a proof's house style (layout, colors, legend, signature) as a reusable template/preset; new proofs start from one. |

Also toward v2: GIF maker, curated tools-links page, command palette (Ctrl+K),
full-text case search, timezone + local-time readout at coords, clipboard
capture (paste an image or a URL anywhere → filed as media with provenance),
scale bar + north arrow + optional graticule burned into captures
(preference-toggled auto-inclusion, extension/widget capture path included),
read EXIF/GPS at media import → suggest place/time, Post Composer targets beyond
X (Mastodon, Bluesky, generic report). Grow the two shipped GEOINT tools:
Coordinates gains map-URL paste (reuse the extension's `parse_map_url`) and a
Satellite hand-off; Reverse Search gains an optional TinEye-API-keyed
oldest-date origin hint (Settings key, labeled a hint).

Engineering (toward v2): split the monolith tool components (Satellite,
ProofComposer) by extracting their logic into `lib/` modules like the other
tools; add component/interaction tests (Playwright) for the canvas gestures the
`lib` unit tests can't reach.

### v3 — investigation layer

| Tool | What it does |
|------|--------------|
| **Case Board / Relations** | Browse/create/merge entities; typed links; graph/timeline/map views over the schema filling since v1. |
| **Map Board (MyMaps-style)** | Editable case map: custom pins + notes/links, shapes, layers; import/export KML/KMZ/GeoJSON; pins bind to `place`. |
| **Evidence Locker** | Per-item sha256/timestamps/source/notes; Wayback archiving; exportable chain-of-custody (`evidence.jsonl`). |
| **Timeline Builder** | Timestamped events from mixed sources aligned on timeline + map. |
| **Report Builder** | Assemble proofs/maps/timeline/entities/notes into HTML/PDF. |

Also toward v3: dependency-aware delete (partly done), downloader cookies,
archive-on-download + archive time machine (Wayback CDX snapshot timeline +
diff), web-page save extension, case bundle export/import, an editable/filterable
places table (CSV/GeoJSON export), temporal change detection over imagery dates, a pattern-of-life map (a source's
extractable locations on map + timeline), a full chronolocation solver
(shadow + sun + weather → dated window), auto-hash + timestamp on every export
(proof.png etc.) recorded in the evidence journal, cross-case global search (a
handle/coordinate/face across all cases, distinct from the in-case full-text
search), optional X/Twitter API key in Settings (with quota) to auto-publish
Post Composer threads when enabled.

### v4 — orchestration & advanced

| Tool | What it does |
|------|--------------|
| **Search Orchestrator** | Run username/alias/email across services, analyst selects → entities. Integrations, not clones. |
| **OSM Query (Overpass)** | Form-based feature search → map, no Overpass QL. |
| **Viewshed / Line of Sight** | What terrain is visible from a point (public DEM tiles). |
| **Camera Resection (GCP)** | Mark matching points photo↔map → solve camera position, viewing azimuth and rough FOV (OpenCV solvePnP); saves the match as evidence. Inverse of Viewshed. |
| **Map Measures** | Distance, bearing/azimuth, area, FOV cone; includes measure-on-imagery. |
| **Déjà Vu** | Perceptual-hash index flags recycled footage (local first; community index later). |
| **Manipulation Hints** | ELA (in Inspect), JPEG quantization, noise, AI-media detector — all labeled as hints. |
| **Channel Monitor** | Watch Telegram channels, auto-archive media, queue for geolocation (rate limits, ToS care). |

Also toward v4: skyline/horizon matching against a DEM (semi-auto geoloc from a
terrain silhouette), photogrammetric measurement from a resected photo (real
sizes via the GCP camera pose), road-topology search via Overpass (sketch a
junction → candidate spots), satellite-pass finder (public TLEs → who imaged a
place+time).

### After the MapLibre migration

Leaflet → MapLibre GL. **Phase 1** = 2D iso-functional parity (same providers and
captures, zero 3D; existing capture tests stay green, asserting the captured
pixels). **Phase 2** = pitch + terrain + oblique **3D capture**, pitch recorded in
provenance alongside bearing. Then: 3D satellite capture, Google Photorealistic
3D Tiles (user-keyed).

## 7. Loose ideas

No version yet — one line each. Promote into a roadmap table when a workflow
firms up; delete when it stops making sense.

- **Free-form montage editor** — likely unneeded once the free overlay layer
  lands; only with a crisp boundary vs Proof Composer + Inspect collage.
- **In-app OSINT assistant** — a local-model assist layer, no API key and
  no-cloud by default: a chat panel (or opt-in bridge to the user's existing
  LLM chat session) plus a local vision model that *suggests* features/entities
  in a photo (signs, vehicles, landmarks, script) for the analyst to confirm.
- _(add ideas here — keep them one-liners)_

## 8. Explicit non-goals

- No cloud, accounts, hosted service, or telemetry.
- No automated geolocation "magic button" — Azimut files facts, the analyst decides.
- No rebuilding specialized OSINT services — orchestrate them (principle 4).
- No block-evasion scraping; yt-dlp/gallery-dl as-is. Own session cookies = auth
  (in scope); third-party downloader proxies (ssstwitter & co) are out — they
  re-encode media and leak the target.
- No auto-posting by default. An optional, opt-in X/Twitter API key (Settings,
  like the imagery keys) may enable auto-publish from Post Composer, quota
  shown alongside it; Post Composer's default opens X prefilled and never
  posts on its own. No paid API dependency, ever, for core features.

## 9. Architecture

- **Backend**: Python 3.11+, FastAPI on `localhost`; all processing (ffmpeg,
  yt-dlp, gallery-dl, OpenCV, tesseract) runs server-side.
- **Frontend**: Svelte + Leaflet (→ MapLibre) + Konva/canvas, served by the
  backend, opened in the default browser. Rail = workspaces in pipeline order,
  tools are tabs inside them (see [UI.md](UI.md)).
- **Settings & secrets** ✅: in-app tabs (Preferences / Imagery / About), keys
  stored locally and never bundled into a shared case, monthly usage counters,
  backup export/import, opt-out "new release is live" pop-up on load (per-version
  "don't show again"). Display prefs are presentation only — artifacts keep
  decimal degrees + metres on disk.
- **Distribution** ✅: `pip install azimut` + PyInstaller single-file binaries
  (Windows/Linux/macOS) that bundle a static ffmpeg/ffprobe (works out of the
  box; pip installs still want ffmpeg on `PATH`) and carry the app icon on the
  Windows `.exe`.
- **Dependencies** ✅: ranges in `pyproject.toml`, exact pins in `uv.lock`; yt-dlp
  + gallery-dl unbounded on purpose; scraper self-update keeps an old binary useful.
- **Storage**: plain files (§3); SQLite only for rebuildable caches.
- **Security posture** ✅ (single-user localhost): `127.0.0.1` bind + Host/Origin
  guard (DNS rebinding), 0600/0700 perms, 100 MP Pillow clamp, token-gated ingest
  island for the extension. Accepted risks recorded here: cleartext keys over
  localhost, the hash-verified scraper updater, and tile/media URL fetches (SSRF
  only matters if the localhost assumption breaks). The startup update check is
  the one on-mount network call — opt-out, read-only against GitHub's releases
  feed, notes rendered as text (no HTML injection).

## 10. Open questions

- Entity attribute vocabularies, `same-as` merge semantics, confidence levels —
  freeze at v1 release.
- Déjà Vu community index: needs infra + moderation, out of scope until v4.
- Name/handle availability: GitHub org/repo `azimut`, x.com handle, domain.
