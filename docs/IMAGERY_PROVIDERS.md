# Keyed imagery providers — Mapbox, Google (tiles & Maps JS) & Sentinel Hub

> Azimut ships optional user-keyed basemaps alongside the key-less defaults
> (Esri, OSM, OpenTopoMap). The rules below are why their code looks the way it does — they come
> from Google's and Mapbox's terms, not from taste. Read alongside SPEC.md §6
> "v1 notes → Tile providers" (legal-only policy).
>
> Implemented in [`engine/tiles.py`](../src/azimut/engine/tiles.py),
> [`engine/google_tiles.py`](../src/azimut/engine/google_tiles.py),
> [`engine/tilecache.py`](../src/azimut/engine/tilecache.py) and
> [`api/settings.py`](../src/azimut/api/settings.py).

## Legal rules (decided — do not relax)

| Rule | Why |
|------|-----|
| Keys are **user-supplied**, stored **locally**, **never** bundled into a shared case/zip. | Principle 7; keys are the user's own billing identity. |
| Core features never require a key. Key-less providers (Esri, OSM, OpenTopoMap) stay the default. | Principle 7. |
| **Never** ship/suggest/document unofficial endpoints (`mt1.google.com`, `khms*`, …). Only official APIs. | Legal-only policy. |
| **Google tiles must NOT be cached to disk.** | Google's Map Tiles API forbids pre-fetch/store/cache/offline use of tiles ([policies](https://developers.google.com/maps/documentation/tile/policies)). |
| A Google **capture** is allowed only as a **flattened, attributed screenshot** (single PNG, attribution burned in) — never a store of raw tiles. | Google Geo Guidelines permit screenshots in reports/periodicals ≤5,000 copies **with attribution**; the anti-cache clause forbids tile hoarding. Two different acts. |
| Every capture keeps provider **attribution** (Google/Mapbox + data providers, e.g. Maxar) unmodified. For Google it is **burned into the image footer**. | Attribution is a condition of the allowed use, not a courtesy. |

### Per-provider capability matrix

| Provider | `needs_key` | auth style | `capturable` | `cacheable` (tile disk cache) | attribution source |
|----------|:-----------:|------------|:------------:|:-----------------------------:|--------------------|
| Esri World Imagery | no | — | yes | yes | static string |
| OpenStreetMap | no | — | yes | yes | static string |
| OpenTopoMap | no | — | yes | yes | static string (CC-BY-SA² ) |
| **Mapbox Satellite** | yes | access token in URL | yes | yes¹ | `© Mapbox © OpenStreetMap` (+ Maxar) |
| **Google Satellite** | yes | **session token** | yes (flattened+attributed only) | **NO** | dynamic copyright from viewport endpoint |
| **Google Satellite (Maps JS)** | yes | key in script URL⁴ | screen crops only (user-initiated grab, attribution burned) | n/a (widget) | `Map data © Google` + the widget's own credits |
| **Sentinel-2 (Sentinel Hub)** | yes | instance ID in URL³ | yes | yes | `© Copernicus Sentinel data {year}` |

¹ Display + static-image capture with attribution is permitted; plan-level
caching/redistribution limits vary, so the cache stays modest (30-day TTL) and
attribution always on.

² Free for any use, commercial included, *provided* the attribution line stays
visible — CC-BY-SA makes it a licence condition, not a courtesy. The tile
policy's only real limit is "no mass downloads", which a single-user workbench
never approaches. Topographic, so `imagery=false` (the labels overlay would
double its own labels). Its tile server stops at **z17** and answers deeper
zooms with a constant "max zoom layer = 17" placard — registered in
`PLACEHOLDER_TILE_SHA256`, and the live map caps its zoom at the provider max
so it is never requested. Verified 2026-07.

³ Open data (Copernicus free/full/open licence) — the licence asks only for
attribution, so no capture or cache restriction. The constraint is quota, not law.
The instance ID is the **whole credential**: OGC needs no OAuth token on top of it
(verified 2026-07 — a wrong id answers `400 Invalid instance id`, never a 401). It
is still the user's quota identity, so it lives in `api_keys` like any other key.

⁴ A Maps JS key is client-side **by design** (referrer-restricted, not secret), so
shipping it to the browser in the loader URL is the intended use — unlike every
tile key, which stays server-side behind the proxy.

## Google in the EEA (2025-07-08) — why there are two Google entries

Google stopped serving **satellite tiles** (Map Tiles API *and* Static Maps API)
to projects with an **EEA billing address**: 403 `PERMISSION_DENIED` with the
explanation in the error body ([Map Tiles notice](https://developers.google.com/maps/comms/eea/map-tiles),
[Static notice](https://developers.google.com/maps/comms/eea/maps-static) — a
Bundeskartellamt outcome, not a bug). Applies to projects created after that date
or that later left "Unmodified State". Non-EEA accounts keep the tile pipeline.

The one official Google satellite route left in the EEA is the **Maps JavaScript
API widget** — so Azimut ships both:

| | Google Satellite (tiles) | Google Satellite (Maps JS) |
|---|---|---|
| Works in the EEA | **no** (403) | yes |
| Rendering | XYZ tiles through our proxy | a real `google.maps.Map` under Leaflet (GoogleMutant plugin, Beerware licence) |
| Captures | stitched crop, attribution burned | **screen pixels only** — same Capture button, modes and frame; the crop comes from one tab screenshot taken by the **capture extension** (Settings → Capture extension; the button gates on it). Attribution burned, `method:"screenshot"` + `framed:true` |
| Capture frame | any size (tiles are fetched) | can't exceed the map view — screen pixels are the ceiling, so no resolution multiplier |
| Rotation / oversample / marquee | yes | **rotation + marquee yes**, oversample no |
| Meter | tiles | **map loads** (~10k free/month) — the widget layer is created once per *page life* and reused across tab and basemap switches, since every instantiation bills a load; this is also why eco mode is pinned off for it. Reloading the app is therefore a real +1, which is why the counter climbs while developing |
| Key test | `createSession` server-side | in-browser only (`gm_authFailure`), from Settings; a *changed* key needs an app reload — Google's script binds one key per page life. **Costs a map load** and reports it to the meter (a rejected key is free) |

Both keys can be saved at once: each lights its own basemap, and the EEA failure
path benches the tiles one automatically (below) leaving the widget on offer.
Leaflet keeps all interaction, so measure tools, places, reference windows and
the labels overlay work unchanged over the widget.

### The widget is a normal basemap, with one seam

GoogleMutant runs a **hidden** `google.maps.Map` and clones its `<img>` tiles into
an ordinary Leaflet `GridLayer`. Two consequences worth knowing:

- **Rotation works.** The visible tiles are Leaflet tiles in the rotatable tile
  pane, and leaflet-rotate already asks the grid for the rotated bounding box.
  The only catch is coverage: the hidden map renders the *unrotated* viewport, so
  a turned view wants corner tiles that were never rendered — blank corners.
  `lib/gmaps.js` sizes the hidden map to a **square of the container's diagonal,
  centred**, which covers every bearing at once. Extra tile renders inside one
  map load are free; the billing is per `google.maps.Map`.
- **Those cloned tiles are still off-limits.** Reading them back (canvas,
  html2canvas, refetching the URLs) is exactly the programmatic extraction
  Google's terms forbid — the fact that they sit in our DOM changes nothing. The
  capture path therefore goes through the **capture extension** (`extension/`,
  installed from Settings): one `tabs.captureVisibleTab` behind the user's
  click — the browser-blessed tab screenshot. No share prompt, no sharing bar,
  and fullscreen survives, which the earlier `getDisplayMedia` route broke
  (the share prompt drops fullscreen and relayouts the map under a
  just-measured frame). Without the extension the Capture button explains and
  points at Settings — never a half-working fallback.

What the screen-pixel route still forces, whatever supplies the frame:

| Trap | Rule |
|---|---|
| The tab frame is the **whole viewport** — our HUD, control clusters and reference windows paint *over* the map and would land in the crop | `.map-wrap.grabbing` hides our chrome for the grab (`:global`, or the reference windows — a child component — slip through scoped CSS). The marker stays: the tile path burns one in, so a screen crop keeps its own |
| A frame can silently be the **wrong surface** (browser zoom changed mid-flight, a stale frame from before a resize) and the crop math is one scale factor — it would crop real pixels off the wrong place and look fine doing it | Check registration (`lib/screenCrop.js isRegistered`, viewport aspect) on **every frame** before cropping; refuse on mismatch |
| `captureVisibleTab` needs **activeTab or `<all_urls>`** — host permissions are NOT enough (verified: both browsers refuse), so a page-initiated capture fails on a fresh tab | One extension click (icon or `Alt+Shift+A`) grants activeTab **for the tab's whole life** (the app is an SPA — no navigation, so once per session). The app turns the refusal into a "click the icon once" toast, and the popup pings back so the app can say "press Capture again". Never `<all_urls>` |

**Provenance:** `framed` says what the coordinates mean. `true` — the crop was
taken through the capture frame, so lat/lon is the crop centre. `false` — a
pasted/dropped image, so lat/lon is only the map view when it was filed.

**A failed capture is never downgraded into an import.** A frame that can't be
registered is refused with an error and nothing is filed — the paste dialog is a
deliberate choice from the capture menu, never an escape hatch offered after a
failure. Quietly proposing to file *some other image* instead is how an
unregistered picture ends up wearing a capture's provenance.

### The capture extension (`extension/`, api/ingest.py)

One MV3 extension (Chrome/Edge + Firefox), two flows:

| | Azimut's Maps JS basemap | External map sites |
|---|---|---|
| Trigger | the app's own Capture button (bridge content script relays) | toolbar click / `Alt+Shift+A` → popup → drag an area |
| Sites | localhost only | Google Maps/Earth, Bing, Yandex, OSM, Apple Maps, Zoom Earth, Satellites.pro, Copernicus Browser — **refuses non-map sites**, enforced by the endpoint too |
| Metadata | the app's own view (registered crop, `framed:true`) | parsed from the page **URL only**, never the DOM — coordinates, zoom, bearing, place name (→ title), imagery date where the URL carries one (Copernicus `toTime`, Zoom Earth `/date=`); correctable in the popup; may be empty |
| Filing | the app files same-origin — no pairing | `POST /api/ingest/screenshot`, gated by a **pairing token** (Settings → copy, extension options → paste) + CORS open to extension origins only; an SSE nudge (`/api/events`) makes the capture appear in any open app tab without a reload |
| Attribution | burned by the app | burned server-side per site (`api/ingest.py ATTRIBUTIONS`), source URL + site + timestamp always in provenance |

**The extension is deliberately dumb** (owner decision, same logic as the
unbounded yt-dlp ranges): it screenshots and sends the URL, and every URL
format rule lives in `engine/mapsites.py` — the popup's prefill is
`GET /api/ingest/parse`, and the POST re-derives site/attribution/metadata
from the URL itself, trusting the client for nothing but its own corrections.
URL formats race sites that change without notice, and the extension is the
one component that can't be updated remotely (loaded unpacked, no store) —
so a changed format must cost an app update, never a hand reinstall on every
machine. Don't add site knowledge to the extension.

Legal rails, encoded in both the extension and the endpoint: one screenshot per
explicit user action (nothing schedulable), URL-only metadata, on-screen
credits ride along inside the pixels, attribution burned on top.

## Dead keys bench their basemap

`settings.json → provider_status` holds each credential's last verdict. Written
by: the Settings key test (every provider), a `createSession` refusal or a tile
401/403 that survives the re-mint retry (with Google's own sentence as the
reason), and the browser's `gm_authFailure` for the JS key. **Never** by plain
network errors — a timeout says nothing about the key. A key marked bad is
withheld from `all_providers()`, so the basemap vanishes from the selector (the
live map falls back to Esri) until the key changes (verdict cleared) or a test
passes. Settings shows the stored reason inline.

## Per-provider eco thresholds

`eco_max_zooms` in settings.json lets each tile basemap carry its own eco
threshold (blank = provider default, else the global one; 0 = eco off for it).
Needed because one global value can't fit both a z22 basemap and Sentinel-2's
z14 ceiling — and the JS widget is excluded entirely (a swap re-bills a load).

## Sentinel-2 is a dated mosaic, not a basemap

Use the **OGC WMTS** endpoint — not Catalog (STAC metadata only, no pixels) and not
the Process API (POST + evalscript; buys band math, fits nothing in the XYZ
pipeline — deferred with Satellite Compare).

```
https://sh.dataspace.copernicus.eu/ogc/wmts/{key}?SERVICE=WMTS&REQUEST=GetTile
  &VERSION=1.0.0&LAYER=TRUE_COLOR&TILEMATRIXSET=PopularWebMercator512
  &TILEMATRIX={z}&TILECOL={x}&TILEROW={y}&FORMAT=image/jpeg
```

`{key}` is a **configuration instance** UUID (Dashboard → Configuration Utility),
built from the **Simple Sentinel-2 L2A template** — that template is what makes
`TRUE_COLOR` exist. L2A (bottom-of-atmosphere) over L1C: corrected colour, and the
120 m mosaic / 20 m Europe-only templates are too coarse or too regional to be a
basemap at all. **"Show logo" and "Show warnings" must be off in the instance** —
both are burned into every tile server-side, which would tile the map with
Copernicus logos and put one inside evidence captures.

`TIME` is a **mosaicking window**, so this layer is "mosaic over range X", not "the
imagery". Omitted, the layer's own default applies (the most recent pass).

**The layer and the window ride on the provider id** — `sentinel2~SWIR~2026-05-01~2026-05-31`
(`engine/sentinel.py`, mirrored in `frontend/src/lib/sentinel.js`). That is what
solves the cache trap this section used to warn about: the disk cache keys on
`provider.id`, so a window in the id *is* a window in the cache key and two dates
can never collide. It also means the tile proxy, `fetch_crop` and a capture's
provenance all inherit the choice for free — none of them can render from one
window and file under another. `tiles.get_provider()` parses the variant;
`parse_variant` is the validation boundary (the id becomes a URL path segment
*and* a cache directory, so the shape is an allowlist).

| Choice | UI | Notes |
|--------|----|-------|
| Layer | picker, populated from **GetCapabilities** on first open | `LAYERS` in `engine/sentinel.py` is a 4-entry *fallback*; the instance is the authority on what it serves — offering a layer it lacks just 400s on selection |
| Date | a **calendar**: only days with a real pass are selectable, coloured by cloud | one day, not a range — a range is a mosaic of several passes and can't be dated. Sent as `TIME=day/day` |

### Dates come from WFS, and cost one request

`GET /ogc/wfs/{instance}?TYPENAMES=DSS2&TIME=…&BBOX=…&OUTPUTFORMAT=application/json`
— same instance credential, no OAuth (Catalog would need one). `DSS2` is L2A: a
date list from L1C would be a plausible lie about a different collection.
`SRSNAME=EPSG:4326` puts **latitude first** in the BBOX.

Billed at **0.01 PU but one whole request**, so `record_usage` counts it as 1:
both quotas are 30k, the meter tracks requests exactly and over-states PU
slightly — the conservative direction. Hence the meter's unit is "request", not
"tile" (`meterUnit`).

**Granule footprints are checked against the point** (`_covers`). A granule's
bounding box is a square; its data is the slice of orbit swath inside it. WFS
answers on the box, so without the check a day gets listed, pinned, and renders
**black** — exactly the failure a date list exists to prevent. The footprint is
tested under both axis orders: read backwards, every granule on Earth would be
rejected.

**Its levels are numbered by resolution, not by grid width.** `TILEMATRIX=14` is
9.55 m/px on an 8192-wide grid — the same imagery Mapbox calls z13. Tile indices
stay at the repo's `tile_z` either way, so only the level's *name* differs:
`Provider.zoom_offset=1` re-adds what `z_shift` took off. Getting this wrong is not
subtle — the service answers `400 Invalid TILECOL`.

**Eco mode needs its own threshold here** (`Provider.eco_max_zoom=11`). The global
default (z15) is tuned for basemaps that run to z22; Sentinel-2's imagery stops at
z14, so sharing it would swap the layer away at most zooms it can serve. At z11 and out a
Sentinel-2 pixel is ~40 m of ground and Esri shows the same scene for free — the
swap costs a known date for an unknown one, which only pays where the resolution
adds nothing anyway.

| Limit | Value | Consequence |
|-------|-------|-------------|
| Native resolution | 10 m/px ≈ 9.55 m/px at `TILEMATRIX=14` | `max_native_zoom=14` — deeper is Sentinel Hub upsampling we'd pay full price for |
| Useful zoom | z18 | `max_zoom=18`, on **magnified native tiles** — see below |
| Free quota | **30 000 requests + 30 000 PU/month** (Copernicus General) | `meter="sentinelhub"`; per-account and **editable in Settings** — see below |
| Rate | 300 req/min, 300 PU/min | why tiles stay 512 |
| PU cost | 512×512, 3 bands, 8-bit = **exactly 1 PU** | one tile = 1 request = 1 PU, so the counter is faithful |

PU scales with **area**, so tile size is cost-neutral (1024 → 4 PU, 256 → 0.25 PU):
Google's big-tile trick buys nothing here. 512 wins on the requests/min limit alone.

### The view goes deeper than the pixels

`max_native_zoom` (14) and `max_zoom` (18) are different questions: where the
imagery *stops*, and where looking at it stops being useful. You cannot read a
ship at 10 m/px from three levels out, so the view runs to z18 while requests
stop at 14 and the last native tile is magnified — same pixels, larger, **zero
extra requests**. Asking Sentinel Hub for z18 would buy its upsampling of those
same pixels at 16× the tiles, every one billed: the identical image, paid for.

Leaflet's `maxNativeZoom` does it on the live map; `fetch_crop` mirrors it so a
capture matches the screen, and records `native_zoom` +
`native_meters_per_pixel` next to `zoom` — the image is real, its resolution is
not what the zoom implies, and a reader has to be able to tell. The tile proxy
refuses to fetch past the ceiling at all (`_native_grid_zoom`), for anything
that isn't the live map.

### Free tiers are facts about the account, not about us

Copernicus **documents 10 000** PU/month and **provisions 30 000** (observed
2026-07, `copernicus-general-quota`). So `config.FREE_TIER` is a *default*, and
`free_tiers` in settings.json overrides any meter (`config.free_tier()`,
editable per provider under Settings → Usage). A hardcoded number makes the
gauge and the 90% soft block lie about someone else's account — and the block
pausing a provider that is nowhere near its limit is a real failure, not a
cosmetic one.
[Quotas](https://documentation.dataspace.copernicus.eu/Quotas.html) ·
[PU definition](https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Overview/ProcessingUnit.html)

## Google is not a static `{key}` URL

It needs a session token, minted and refreshed transparently before the rest of the
pipeline sees a normal XYZ template:

1. `POST https://tile.googleapis.com/v1/createSession?key={API_KEY}` →
   `{"session":"<token>","expiry":"<unix>",…}`. Session params (mapType) are part
   of the token identity.
2. Tiles: `GET https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session={token}&key={API_KEY}`
3. Refresh on expiry or on 401/403.
4. Attribution: `GET https://tile.googleapis.com/tile/v1/viewport?session={token}&key={API_KEY}&zoom={z}&north=&south=&east=&west=`
   → `copyright` (e.g. `"Map data ©2026 Google, Maxar Technologies"`). Never reduced
   to just "Google".

The **token** may be cached; tiles may not.

## Measured findings (2026-07)

**Tile sizes.** Mapbox serves **512px** tiles: it bills 256px tiles 4× vs 512px for
the same ground area at the same m/px. Google serves **1024px hi-DPI** tiles
(`scale=scaleFactor4x, highDpi=true`): it bills per *request* regardless of tile
size, so one request covers sixteen 256px tiles' worth of ground at the same m/px —
verified pixel-identical. Mapbox's `@2x` equivalent is *upsampled* (softer), which
is why Mapbox stays at 512.

**Oversampling.** The live map oversamples Google 2× (1024px tiles in 512px cells,
one zoom deeper) because Google's mid-zoom mosaics are verifiably softer than its
deep ones — net ¼ the cost of plain 256px tiles. The z17 view alone boosts to 4×
(z19 detail): the z18 mosaic it would otherwise show is often an older/hazier
collection than the z19+ aerial. Captures stay 1:1 provider pixels — no resampling
in evidence imagery.

**Billing units.** Both bill **per tile served** — Google's 2D Map Tiles SKU is
"Request that returns a 2D map tile" (session and viewport requests are free);
Mapbox Static Tiles bills per tile request when used with Leaflet. Free tiers:
Google 100k/month then $0.60/1k (plus hard limits of 15k tiles/day and 6k/min per
project), Mapbox 200k/month then $0.50/1k (no hard cap — alerts only). Metered
tiles are proxied through the backend so the counter matches billing exactly;
browser cache hits never re-count.

## Deliberately not basemaps

Street View and Google Photorealistic 3D Tiles are keyed Google products but not
tile providers — a ground-imagery tool and a 3D scene respectively. They live in the
SPEC backlog, not here.
