# Keyed imagery providers

> Azimut offers optional Mapbox, Google and Sentinel Hub providers alongside the
> keyless defaults. Their legal and technical constraints define the implementation.
>
> Implemented in [`engine/tiles.py`](../src/azimut/engine/tiles.py),
> [`engine/google_tiles.py`](../src/azimut/engine/google_tiles.py),
> [`engine/tilecache.py`](../src/azimut/engine/tilecache.py) and
> [`api/settings.py`](../src/azimut/api/settings.py).

## Legal rules

| Rule | Why |
|------|-----|
| Keys are **user-supplied**, stored **locally**, **never** bundled into a shared case/zip. | Principle 7; keys are the user's own billing identity. |
| Core features never require a key. Key-less providers (Esri, OSM, OpenTopoMap) stay the default. | Principle 7. |
| **Never** ship/suggest/document unofficial endpoints (`mt1.google.com`, `khms*`, …). Only official APIs. | Legal-only policy. |
| **Google tiles must NOT be cached to disk.** | Google's Map Tiles API forbids pre-fetch/store/cache/offline use of tiles ([policies](https://developers.google.com/maps/documentation/tile/policies)). |
| A Google **capture** is a flattened, attributed PNG, never stored raw tiles. | Google permits attributed screenshots in reports and periodicals up to 5,000 copies; its anti-cache rule still forbids tile storage. |
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
visible. CC-BY-SA makes it a licence condition. The tile
policy's only real limit is "no mass downloads", which a single-user workbench
never approaches. Topographic, so `imagery=false` (the labels overlay would
double its own labels). Its tile server stops at **z17** and answers deeper
zooms with a constant "max zoom layer = 17" placard. It is registered in
`PLACEHOLDER_TILE_SHA256`, and the live map caps its zoom at the provider max
so it is never requested. Verified 2026-07.

³ Open data under the Copernicus free, full and open licence. It requires
attribution, so no capture or cache restriction. The constraint is quota, not law.
The instance ID is the **whole credential**: OGC needs no OAuth token on top of it
(verified 2026-07: a wrong id answers `400 Invalid instance id`, never a 401). It
is still the user's quota identity, so it lives in `api_keys` like any other key.

⁴ A Maps JS key is client-side **by design** (referrer-restricted, not secret), so
shipping it to the browser in the loader URL is intended. Every
tile key, which stays server-side behind the proxy.

## Google in the EEA since 2025-07-08

Google stopped serving **satellite tiles** (Map Tiles API *and* Static Maps API)
to projects with an **EEA billing address**: 403 `PERMISSION_DENIED` with the
explanation in the error body ([Map Tiles notice](https://developers.google.com/maps/comms/eea/map-tiles),
[Static notice](https://developers.google.com/maps/comms/eea/maps-static)). This
applies to projects created after that date
or that later left "Unmodified State". Non-EEA accounts keep the tile pipeline.

The Maps JavaScript API widget remains the official Google satellite route in the
EEA, so Azimut supports both products:

| | Google Satellite (tiles) | Google Satellite (Maps JS) |
|---|---|---|
| Works in the EEA | **no** (403) | yes |
| Rendering | XYZ tiles through our proxy | a real `google.maps.Map` under Leaflet (GoogleMutant plugin, Beerware licence) |
| Captures | stitched crop, attribution burned | **screen pixels only** from one tab screenshot taken by the capture extension; attribution burned, `method:"screenshot"`, `framed:true` |
| Capture frame | any size (tiles are fetched) | limited to the map view; no resolution multiplier |
| Rotation / oversample / marquee | yes | **rotation + marquee yes**, oversample no |
| Meter | tiles | **map loads** (~10k free/month); one widget instance per page life, reused across tabs and basemap switches; eco mode disabled because a replacement instance bills another load |
| Key test | `createSession` server-side | in-browser `gm_authFailure`; a changed key requires reload; an accepted key test bills and records one map load |

Both keys can be saved at once: each lights its own basemap, and the EEA failure
path benches the tiles one automatically (below) leaving the widget on offer.
Leaflet keeps all interaction, so measure tools, places, reference windows and
the labels overlay work unchanged over the widget.

### Maps JS widget behavior

GoogleMutant runs a hidden `google.maps.Map` and clones its `<img>` tiles into a
Leaflet `GridLayer`.

- **Rotation works.** The visible tiles are Leaflet tiles in the rotatable tile
  pane, and leaflet-rotate already asks the grid for the rotated bounding box.
  The hidden map renders the unrotated viewport, so a turned view can otherwise
  expose blank corners.
  `lib/gmaps.js` sizes the hidden map to a **square of the container's diagonal,
  centred**, which covers every bearing at once. Extra tile renders inside one
  map load are free; the billing is per `google.maps.Map`.
- **Cloned tiles remain off-limits.** Reading them through canvas, html2canvas or
  their URLs is programmatic extraction forbidden by Google's terms. The
  capture path therefore goes through the **capture extension** (`extension/`,
  installed from Settings): one `tabs.captureVisibleTab` behind the user's
  click. This avoids the share prompt and preserves fullscreen, unlike the earlier
  `getDisplayMedia` route. Without the extension, Capture directs the user to
  Settings and does not offer a fallback.

What the screen-pixel route still forces, whatever supplies the frame:

| Trap | Rule |
|---|---|
| The tab frame covers the whole viewport, including Azimut chrome | `.map-wrap.grabbing` hides the HUD, controls and child reference windows through `:global`. The marker stays because tile captures burn one into their output too. |
| Browser zoom or resize can make a frame belong to the wrong surface | Validate every frame with `lib/screenCrop.js isRegistered` and the viewport aspect; refuse mismatches. |
| `captureVisibleTab` needs `activeTab` or `<all_urls>`; host permission is insufficient | One extension click grants `activeTab` for the SPA tab's life. The app explains this once. Never request `<all_urls>`. |

**Provenance:** `framed:true` means lat/lon is the registered crop centre.
`framed:false` means lat/lon records only the map view used while filing a pasted
or dropped image.

A frame that fails registration is refused and nothing is filed. Importing a
pasted screenshot remains a separate capture-menu action so it cannot inherit
registered-frame provenance.

### The capture extension (`extension/`, api/ingest.py)

One MV3 extension (Chrome/Edge + Firefox), two flows:

| | Azimut's Maps JS basemap | External map sites |
|---|---|---|
| Trigger | the app's own Capture button (bridge content script relays) | toolbar click / `Alt+Shift+A` → popup → drag an area |
| Sites | localhost only | Google Maps/Earth, Bing, Yandex, OSM, Apple Maps, Zoom Earth, Satellites.pro and Copernicus Browser; endpoint also refuses non-map sites |
| Metadata | app view (`framed:true`) | parsed only from the URL: coordinates, zoom, bearing, place name and any encoded imagery date; correctable in the popup; may be empty |
| Filing | same-origin, no pairing | token-gated `POST /api/ingest/screenshot`, CORS limited to extension origins; `/api/events` refreshes open app tabs |
| Attribution | burned by the app | burned server-side per site (`api/ingest.py ATTRIBUTIONS`), source URL + site + timestamp always in provenance |

The extension only screenshots and sends the URL. Every URL format rule lives in
`engine/mapsites.py`; the popup prefill is
`GET /api/ingest/parse`, and the POST re-derives site/attribution/metadata
from the URL itself, trusting the client for nothing but its own corrections.
The unpacked extension cannot update remotely, while the app can. Keep site
knowledge in the app so format changes do not require reinstalling the extension.

Legal rails, encoded in both the extension and the endpoint: one screenshot per
explicit user action (nothing schedulable), URL-only metadata, on-screen
credits ride along inside the pixels, attribution burned on top.

## Dead keys bench their basemap

`settings.json → provider_status` holds each credential's last verdict. Written
by: the Settings key test (every provider), a `createSession` refusal or a tile
401/403 that survives the re-mint retry (with Google's own sentence as the
reason), and the browser's `gm_authFailure` for the JS key. **Never** by plain
network errors; a timeout says nothing about the key. A key marked bad is
withheld from `all_providers()`, so the basemap vanishes from the selector (the
live map falls back to Esri) until the key changes (verdict cleared) or a test
passes. Settings shows the stored reason inline.

## Per-provider eco thresholds

`eco_max_zooms` in settings.json lets each tile basemap carry its own eco
threshold (blank = provider default, else the global one; 0 = eco off for it).
Needed because one global value can't fit both a z22 basemap and Sentinel-2's
z14 ceiling. The JS widget is excluded because replacing it bills another load.

## Sentinel-2 is a dated mosaic, not a basemap

Use the OGC WMTS endpoint. Catalog provides STAC metadata but no pixels. The
Process API requires POST and evalscript, so band math remains deferred with
Satellite Compare.

```
https://sh.dataspace.copernicus.eu/ogc/wmts/{key}?SERVICE=WMTS&REQUEST=GetTile
  &VERSION=1.0.0&LAYER=TRUE_COLOR&TILEMATRIXSET=PopularWebMercator512
  &TILEMATRIX={z}&TILECOL={x}&TILEROW={y}&FORMAT=image/jpeg
```

`{key}` is a configuration-instance UUID from Dashboard → Configuration Utility.
Use the Simple Sentinel-2 L2A template, which defines `TRUE_COLOR`. L2A provides
corrected bottom-of-atmosphere colour; the 120 m mosaic and 20 m Europe-only
templates are unsuitable as basemaps. Turn off **Show logo** and **Show warnings**
because the server burns both into every tile.

`TIME` is a **mosaicking window**, so this layer is "mosaic over range X", not "the
imagery". Omitted, the layer's own default applies (the most recent pass).

The provider id carries the layer and window:
`sentinel2~SWIR~2026-05-01~2026-05-31`
(`engine/sentinel.py`, mirrored in `frontend/src/lib/sentinel.js`). That is what
solves the cache trap this section used to warn about: the disk cache keys on
`provider.id`, so a window in the id *is* a window in the cache key and two dates
can never collide. It also means the tile proxy, `fetch_crop` and a capture's
provenance all inherit the choice. None can render from one
window and file under another. `tiles.get_provider()` parses the variant;
`parse_variant` is the validation boundary (the id becomes a URL path segment
*and* a cache directory, so the shape is an allowlist).

| Choice | UI | Notes |
|--------|----|-------|
| Layer | picker populated from **GetCapabilities** on first open | `LAYERS` in `engine/sentinel.py` is a four-entry fallback; the instance is authoritative, so unsupported layers are not offered |
| Date | a **calendar**: candidate pass days are coloured by cloud, then checked at the crosshair | one day, not a range. Sent as `TIME=day/day` |

### Dates come from WFS, and cost one request

`GET /ogc/wfs/{instance}?TYPENAMES=DSS2&TIME=…&BBOX=…&OUTPUTFORMAT=application/json`
uses the same instance credential and no OAuth. `DSS2` is L2A; a
date list from L1C would be a plausible lie about a different collection.
`SRSNAME=EPSG:4326` puts **latitude first** in the BBOX.

Billed at **0.01 PU but one whole request**, so `record_usage` counts it as 1:
both quotas are 30k. The meter tracks requests exactly and slightly overstates PU,
so its unit is "request", not
"tile" (`meterUnit`).

**Granule footprints are checked against the point** (`_covers`). A granule's
bounding box is a square; its data is the slice of orbit swath inside it. WFS
answers on the box, so without the check a listed day can render black. The footprint is
tested under both axis orders: read backwards, every granule on Earth would be
rejected.

WFS dates are still candidates. Before changing the map, the picker sends an
8×8 WMS `dataMask` check for the selected layer and day. A failed check leaves
the current map in place and marks the date unavailable at that location. The
result is cached by layer, date and rounded coordinates. Moving the map disables
the old dates until the list refreshes. A successful check counts as one more
Sentinel Hub request.

**Its levels are numbered by resolution, not by grid width.** `TILEMATRIX=14` is
9.55 m/px on an 8192-wide grid, equivalent to Mapbox z13. Tile indices
stay at the repo's `tile_z` either way, so only the level's *name* differs:
`Provider.zoom_offset=1` re-adds what `z_shift` took off. A wrong offset returns
`400 Invalid TILECOL`.

**Eco mode needs its own threshold here** (`Provider.eco_max_zoom=11`). The global
default (z15) is tuned for basemaps that run to z22; Sentinel-2's imagery stops at
z14, so sharing it would replace the layer at most supported zooms. At z11 and
out, one Sentinel-2 pixel covers about 40 m and free Esri imagery has comparable
detail. The swap is limited to those low-detail views.

| Limit | Value | Consequence |
|-------|-------|-------------|
| Native resolution | 10 m/px ≈ 9.55 m/px at `TILEMATRIX=14` | `max_native_zoom=14`; deeper requests only buy server-side upsampling |
| Useful zoom | z18 | `max_zoom=18` on magnified native tiles |
| Free quota | **30 000 requests + 30 000 PU/month** (Copernicus General) | `meter="sentinelhub"`; per-account and editable in Settings |
| Rate | 300 req/min, 300 PU/min | why tiles stay 512 |
| PU cost | 512×512, 3 bands, 8-bit = **exactly 1 PU** | one tile = 1 request = 1 PU, so the counter is faithful |

PU scales with **area**, so tile size is cost-neutral (1024 → 4 PU, 256 → 0.25 PU):
Google's big-tile trick buys nothing here. 512 wins on the requests/min limit alone.

### The view goes deeper than the pixels

`max_native_zoom` (14) and `max_zoom` (18) are different questions: where the
imagery *stops*, and where looking at it stops being useful. You cannot read a
ship at 10 m/px from three levels out, so the view runs to z18 while requests
stop at 14 and magnify the last native tile without extra requests. Asking
Sentinel Hub for z18 would bill 16 times as many tiles for server-side upsampling.

Leaflet's `maxNativeZoom` does it on the live map; `fetch_crop` mirrors it so a
capture matches the screen, and records `native_zoom` +
`native_meters_per_pixel` next to `zoom`. This records that the native resolution
is lower than the display zoom implies. The tile proxy
refuses to fetch past the ceiling at all (`_native_grid_zoom`), for anything
that isn't the live map.

### Free tiers are facts about the account, not about us

Copernicus **documents 10 000** PU/month and **provisions 30 000** (observed
2026-07, `copernicus-general-quota`). So `config.FREE_TIER` is a *default*, and
`free_tiers` in settings.json overrides any meter (`config.free_tier()`,
editable per provider under Settings → Usage). A hardcoded number makes the
gauge and 90% soft block can match the user's account rather than a global
assumption.
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
size, so one request covers sixteen 256px tiles' worth of ground at the same m/px;
the output was verified pixel-identical. Mapbox's `@2x` equivalent is upsampled, so
is why Mapbox stays at 512.

**Oversampling.** The live map oversamples Google 2× (1024px tiles in 512px cells,
one zoom deeper) because Google's mid-zoom mosaics are verifiably softer than its
deep ones, at one quarter the request cost of plain 256px tiles. The z17 view boosts to 4×
(z19 detail): the z18 mosaic it would otherwise show is often an older/hazier
collection than the z19+ aerial. Captures retain provider pixels without resampling
in evidence imagery.

**Billing units.** Both bill per tile served. Google's 2D Map Tiles SKU is
"Request that returns a 2D map tile" (session and viewport requests are free);
Mapbox Static Tiles bills per tile request when used with Leaflet. Free tiers:
Google 100k/month then $0.60/1k (plus hard limits of 15k tiles/day and 6k/min per
project), Mapbox 200k/month then $0.50/1k (alerts only, no hard cap). Metered
tiles are proxied through the backend so the counter matches billing exactly;
browser cache hits never re-count.

## Deliberately not basemaps

Street View and Google Photorealistic 3D Tiles are not basemap providers. They
remain separate ground-imagery and 3D-scene roadmap items.
