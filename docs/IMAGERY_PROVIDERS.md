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
| Esri Wayback | no | — | yes | yes (a release never changes) | static string, release in provenance |
| OpenStreetMap | no | — | yes | yes | static string |
| OpenTopoMap | no | — | yes | yes | static string (CC-BY-SA² ) |
| **Mapbox Satellite** | yes | access token in URL | yes | yes¹ | `© Mapbox © OpenStreetMap` (+ Maxar) |
| **Google Satellite** | yes | **session token** | yes (flattened+attributed only) | **NO** | dynamic copyright from viewport endpoint |
| **Google Satellite (Maps JS)** | yes | key in script URL⁴ | screen crops only (user-initiated grab, attribution burned) | n/a (widget) | `Map data © Google` + the widget's own credits |
| **Sentinel-2 (Sentinel Hub)** | yes | instance ID in URL³ | yes | yes | `© Copernicus Sentinel data {year}` |
| **Sentinel-1 radar (Sentinel Hub)** | yes, plus a radar layer | instance ID in URL³ | yes | yes | `© Copernicus Sentinel data {year}` |

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
| Rendering | XYZ tiles through our proxy | a real `google.maps.Map` under our own map, which is transparent where nothing is drawn |
| Captures | stitched crop, attribution burned | **screen pixels only** from one tab screenshot taken by the capture extension; attribution burned, `method:"screenshot"`, `framed:true` |
| Capture frame | any size (tiles are fetched) | limited to the map view; no resolution multiplier |
| Rotation / oversample / marquee | yes | **rotation + marquee yes**, oversample no |
| Meter | tiles | **map loads** (~10k free/month); one widget instance per page life, reused across tabs and basemap switches; eco mode disabled because a replacement instance bills another load |
| Key test | `createSession` server-side | in-browser `gm_authFailure`; a changed key requires reload; an accepted key test bills and records one map load |

Both keys can be saved at once: each lights its own basemap, and the EEA failure
path benches the tiles one automatically (below) leaving the widget on offer.
Our own map keeps all interaction, so measure tools, places, reference windows
and the labels overlay work unchanged over the widget.

### Maps JS widget behavior

Google's own map renders in its own element **under** ours, and ours is
transparent where nothing is drawn (`lib/map/gmaps.js`, "under glass"). It takes
no pointer events: every gesture and every control is ours, and Google's camera
is moved to follow ours on each frame.

- **Rotation works.** Google has no bearing of its own on a raster satellite
  map, so its element is turned by CSS. A turned rectangle would expose blank
  corners, so the element is a **square of the container's diagonal, centred**,
  which covers every bearing at once — a rotated W×H rectangle always fits
  inside the circle of its own diagonal. Extra tile renders inside one map load
  are free; the billing is per `google.maps.Map`.
- **The credit line is moved upright.** Google renders it inside that oversized,
  turned element, where a bearing would rotate it off screen. It is re-homed
  into a fixed holder at the bottom right, which is the one part of the layer
  that does take the pointer, so the terms link stays clickable. If Google's
  markup ever stops offering that node, the same credit and a terms link are
  stated by us instead — the imagery is never shown bare.
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

Use the OGC WMTS endpoint for pictures. Catalog provides STAC metadata but no
pixels. Band math goes through WMS GetMap with an `EVALSCRIPT` parameter rather
than the Process API, which wants a POST and a separate token; see "Detect reads
band products" below.

```
https://sh.dataspace.copernicus.eu/ogc/wmts/{key}?SERVICE=WMTS&REQUEST=GetTile
  &VERSION=1.0.0&LAYER=TRUE_COLOR&TILEMATRIXSET=PopularWebMercator512
  &TILEMATRIX={z}&TILECOL={x}&TILEROW={y}&FORMAT=image/jpeg&MAXCC=100
```

`{key}` is a configuration-instance UUID from Dashboard → Configuration Utility.
Use the Simple Sentinel-2 L2A template, which defines `TRUE_COLOR`. L2A provides
corrected bottom-of-atmosphere colour; the 120 m mosaic and 20 m Europe-only
templates are unsuitable as basemaps. Turn off **Show logo** and **Show warnings**
because the server burns both into every tile.

`TIME` is a **mosaicking window**, so this layer is "mosaic over range X", not "the
imagery". Omitted, the layer's own default applies (the most recent pass).

**`MAXCC` is always sent, and defaults to 100.** A configuration instance carries
a cloud-coverage data filter of its own — the standard template ships 20% — and a
scene above it is dropped before rendering, so the tile comes back empty rather
than cloudy. Left implicit that reads as the app hiding cloudy days: a date the
calendar offered renders black, and the dataMask probe calls it a coverage gap.
Stating the ceiling on every request (tiles, the probe, the WFS date list) means
what filters a date is our number, not the instance's.

The provider id carries the layer, the window and the ceiling:
`sentinel2~SWIR~2026-05-01~2026-05-31~CC20`
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
| Cloud | a **slider**, 0–100%, default 100 (no filter) | lower it and cloudier passes leave the tiles, the calendar and "most recent" together. Commits on release, so a drag is not a tile per step |

### Dates come from WFS, and cost one request

`GET /ogc/wfs/{instance}?TYPENAMES=DSS2&TIME=…&BBOX=…&OUTPUTFORMAT=application/json`
uses the same instance credential and no OAuth. `DSS2` is L2A; a
date list from L1C would be a plausible lie about a different collection.
`SRSNAME=EPSG:4326` puts **latitude first** in the BBOX.

Billed at **0.01 PU but one whole request**, so `record_usage` counts it as 1:
both quotas are 30k. The meter tracks requests exactly and slightly overstates PU,
so its unit is "request", not
"tile" (`meterUnit`).

**Granule footprints are checked against the query** (`_covered`). A granule's
bounding box is a square; its data is the slice of orbit swath inside it. WFS
answers on the box, so without the check a listed day can render black. The footprint is
tested under both axis orders: read backwards, every granule on Earth would be
rejected.

### Over a drawn area, a date also has a coverage share

`sentinel.acquisitions(rings, …)` runs the same WFS query over the union box of
the areas a Detect sweep would cover, and keeps the footprints instead of
reducing them to a yes/no. Each date comes back with `coverage`: the share of
those areas that day's granules actually reach, measured by sampling a few
hundred points inside the rings and testing each against the footprints — the
geometry already in the module, so no polygon clipper joins the dependency list.
Sampling puts the answer within a percent, which is what a "62% of the areas"
badge can honestly claim; `FULL_COVER = 0.98` is what counts as whole, because a
ring's own edge lands a point or two outside a granule that in truth reaches it.

This is the question a crosshair lookup cannot answer. Sentinel-2 flies 290 km
swaths, so an area wider than one has **no** single day covering it, and a date
picked on its centre sweeps nodata over the rest. The automatic date rules
(`resolve_dates`) take the newest pass that is both under the cloud ceiling and
at full cover, and name the best partial share when there is none.

Still one request for the whole set of areas, not one per area. `truncated` says
the WFS hit its 100-feature ceiling, so older passes in the window are missing.

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

**Eco mode needs its own threshold here** (`Provider.eco_max_zoom=7`). The global
default (z15) is tuned for basemaps that run to z22; Sentinel-2's imagery stops at
z14, so sharing it would replace the layer at most supported zooms. At z7 and out
the view spans a whole region and free Esri imagery serves it just as well. The
swap is limited to those overview zooms.

| Limit | Value | Consequence |
|-------|-------|-------------|
| Native resolution | 10 m/px ≈ 9.55 m/px at `TILEMATRIX=14` | `max_native_zoom=14`; deeper requests only buy server-side upsampling |
| Useful zoom | z18 | `max_zoom=18` on magnified native tiles |
| Free quota | **30 000 requests + 30 000 PU/month** (Copernicus General) | `meter="sentinelhub"`; per-account and editable in Settings |
| Rate | 300 req/min, 300 PU/min | why tiles stay 512 |
| PU cost | 512×512, 3 bands, 8-bit = **exactly 1 PU** | one tile = 1 request = 1 PU, so the counter is faithful |

PU scales with **area**, so tile size is cost-neutral (1024 → 4 PU, 256 → 0.25 PU):
Google's big-tile trick buys nothing here. 512 wins on the requests/min limit alone.

### Detect reads band products, not pictures

A Detect sweep fetches, for each tile and date, the WMTS picture the analyst
reviews and one WMS band product the detector measures (`sentinel.DETECT_PRODUCTS`:
`vessel`, `fire`, `surface`, `index-*`). Each product is four bytes a pixel, so one
metered request carries everything a detector reads:

- **The box is padded by 32 px** (`analyzers.PAD`, 306 m) on every side, so a ship's
  background ring, a coastline and a cloud's edge do not stop at the tile border.
  Checked against raw bands, the padded frame lands on the tile's grid exactly.
- **Reflectance is stretched by a gain of 2** (1.6 for short-wave infrared in
  `surface`). Glint puts open sea near 9% in the near-infrared; the old gain of 8
  saturated at 12.5%, where hulls and wave crests read the same.
- **The fourth byte is the sky**: the scene class in the low four bits and a flag
  for near-infrared under 15%, which is what the engine casts cloud shadows onto.
- **`CLP`/`CLM` are not used.** On Copernicus Data Space they come back as zeros for
  some acquisitions, a thick cloud included, and over bright desert they flag dark
  irrigated fields as cloud when they are there.
- **Input bands cost processing units**, output bands do not: each product asks for
  only the bands its detector reads, plus `SCL`.

Products are cached beside their picture under `<variant>~<product>~v<N>`
(`analyzers.product_cache_id`), so a rerun over the same dates spends nothing,
and `PRODUCT_VERSION` keeps a frame from an older layout from being decoded as a
newer one.

An analyzer of your own reads raw bands instead: `bands-B04-B08`, up to three
Level-2A bands a product, named in the collection's order and checked against
`sentinel.L2A_BANDS` before a script is built, so no free expression reaches an
evalscript. Its channels are 16 bits, reflectance in ten-thousandths (Sentinel-2's
own scale), because an index computed on the server from two dark bands loses its
meaning at a byte's 0.2% step; the fourth channel is the same sky. Pillow cannot
hold 16 bits across four channels, so the engine decodes these with OpenCV and
keeps a run's copy as the PNG that arrived. A recipe reads every three distinct
bands as one more request per date and tile, which the wizard counts. The
builder's preview reads the same products over the view from the tile cache and
fetches the missing ones only when **Read** is pressed, one metered request each,
over at most three tiles a side. A check does the same on the tiles under its
marks alone (`detect_rules.check_tiles`), cache first and **Run all** for the
rest. The shipped examples were calibrated on Planetary Computer's key-less
Level-2A, laid out as this evalscript returns it (the 1000 offset taken off from
processing baseline 04.00, the way Sentinel Hub harmonises), so their marks cost
no Copernicus request until a user runs them.

Difference asks for the same bands over the view on screen (`sentinel.CHANGE_PRODUCTS`:
`change-<index>`, and `change-sky` for the sky alone). Those frames are decoded in
the browser, which draws them into a canvas, so alpha has to stay the data mask —
a canvas premultiplies it — and the sky byte rides in green instead. Nothing is
cached: the view is whatever the camera is on.

### The view goes deeper than the pixels

`max_native_zoom` (14) and `max_zoom` (18) are different questions: where the
imagery *stops*, and where looking at it stops being useful. You cannot read a
ship at 10 m/px from three levels out, so the view runs to z18 while requests
stop at 14 and magnify the last native tile without extra requests. Asking
Sentinel Hub for z18 would bill 16 times as many tiles for server-side upsampling.

The live map stops its tile requests at that level and scales the last one up;
`fetch_crop` mirrors it so a
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

## Sentinel-1 comes through a layer the user adds

Radar is the same account, the same quota and the same configuration instance, but
an instance serves no Sentinel-1 until one of its layers reads it: the WFS answers
`TYPENAME=DSS3 not found!` for an instance built from the Sentinel-2 template
(verified 2026-09). The user adds a layer in the Configuration Utility with
Sentinel-1 GRD as its source, IW mode, VV+VH polarisation, High resolution, any
orbit direction, orthorectification on, gamma0 and no speckle filter; the form
refuses to save until Data processing names a predefined product or a script,
which Azimut replaces anyway. The app shows that form field by field
(`lib/copernicusSetup.js`). Orthorectification doubles a request's processing
units and a speckle filter doubles them again; terrain gamma0 multiplies them by
2.5 (Copernicus PU rules, 2026-09). The processing a layer sets (backscatter coefficient, orthorectification, DEM)
cannot be overridden from an OGC request; only the evalscript can, and ours
replaces the layer's.

Nothing in GetCapabilities says which layer reads which collection. WFS
GetCapabilities does list one feature type per collection the layers use, free,
which says whether any radar layer exists. **Find** (`POST
/api/satellite/sentinel1/layer`) then asks each layer the Sentinel-2 templates do
not ship, at most six, with an 8 × 8 render that reads `VV` and `VH` over the North
Sea off Rotterdam: a Sentinel-2 layer answers 400 and the service's sentence says
why. One request per probe, on the meter. The first layer that answers is kept as
`sentinel1_layer` in settings.json, carried by the backup, and forgotten when the
instance id changes. It can also be named and checked by hand.

- **A pass is a day and a time.** Sentinel-1 passes a place at dawn flying south
  and at dusk flying north, so one day can hold two looks from opposite sides.
  Radar lookups (`collection=sentinel1`) group granules by pass rather than by
  day, name a pass by the UTC time of its first slice (the WFS `time` field, or
  the sensing start in the product name), and derive the direction from the
  local solar hour. Requests carry `TIME` as twenty minutes either side of that
  time (`sentinel.pass_window`), which holds one pass and nothing else.
- **One track compares with itself.** A relative orbit repeats to the second every
  twelve days, whichever satellite flies it; the neighbouring track that also sees
  a place passes about eight minutes off (Dover 2025: orbits 132 and 59 at 17:49
  and 17:41). Two passes within four minutes of each other in the day are one
  track (`sentinel.same_track`), and Detect, Difference and the pickers hold a
  pair to it.
- **The basemap** is `sentinel1`, offered once `sentinel1_layer` is set. A pass
  rides on the id as `sentinel1~2026-05-14~054210` (no colons: the id is a cache
  folder), a day alone as `sentinel1~2026-05-14`, and the plain id is the most
  recent pass. It is drawn in the review composite: VV red from -22 to 2 dB, VH
  green from -30 to -6 dB, their difference blue from 0 to 15 dB.
- **Detect's radar product** (`sar`) carries VV and VH in decibels, a fifth of one
  per step from -35 dB, the first byte never zero where the radar saw something.
  The review picture (`sar-picture`) is rendered by WMS like a product, since
  there is no true colour to borrow.
- **The water mask** (`water`) is a Sentinel-2 product read beside a radar vessel
  sweep: the scene class of the least cloudy pass of the year before the pass's
  month (`PRIORITY=leastCC`), water, land, or unknown where that pass saw cloud,
  shadow or snow. Dry desert is as radar-dark as calm sea in both polarisations,
  and without it the radar alone put 72 candidates on Port Sudan's town and sand.

Calibration used no quota: the scenes were read key-less from Microsoft Planetary
Computer's `sentinel-1-rtc` and `sentinel-2-l2a` collections and encoded in the
products' byte layout. Those are terrain-flattened gamma0; a layer left at the
Sentinel Hub default reads ellipsoid gamma0, which differs little over sea and
flat ground and more on slopes, which is one more reason to ask for
orthorectification.

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
Mapbox Static Tiles bills per tile request on a live map. Free tiers:
Google 100k/month then $0.60/1k (plus hard limits of 15k tiles/day and 6k/min per
project), Mapbox 200k/month then $0.50/1k (alerts only, no hard cap). Metered
tiles are proxied through the backend so the counter matches billing exactly;
browser cache hits never re-count.

## NASA FIRMS is a keyed layer, not a basemap

Active fire detections (`engine/firms.py`) are the one keyed thing here that is
not a picture of the ground: they are laid **over** whichever basemap is
showing, so the key buys a layer and the card in Settings → Imagery carries no
meter, no free-allowance box and no eco threshold. Nothing about it is billed.

| | |
|---|---|
| Credential | one `MAP_KEY`, from the FIRMS page; it serves the global and the US/Canada services alike |
| Where it goes | **in the path** of every request, which is why the browser never builds one: `/api/firms/tiles/{z}/{x}/{y}` for the app, `/api/ingest/firms` for the extension |
| Asking | WMS `GetMap` in EPSG:3857 — the projection the tile grid is already in, so a tile is its own square and nothing is reprojected |
| Live | `fires_viirs_24 / _48 / _72 / _7`, and the same for `fires_viirs_snpp`, `fires_viirs_noaa20` and `fires_modis` |
| History | the same layer names without the suffix, dated with `TIME=from/to`, up to **31 days** per request |
| Zoom ceiling | source tiles stop at z14. Deeper views reuse the z14 tile with nearest-neighbour scaling, keeping each detection visible as a square without another NASA request |
| Allowance | 5,000 requests per 10 minutes, and a long range counts as several. Nothing polls, and a layer that is off asks for nothing |
| Caching | none on disk. The live layers are what is burning now (upstream refreshes every 15 minutes) and a cached fire is a lie with a timestamp; the browser holds one for 5 minutes |

NOAA-21 is left out on purpose: FIRMS gives it the rolling layers and no dated
one, and a sensor that could answer "now" but not "that day" is a trap in a tool
whose second question is always the date.

The extension asks differently for the same reason it draws differently: it has
no tile grid to hang tiles on, so it asks for **one picture of the ground it can
see** per settled view and lays it under its own drawing, rotated with the map.
That is also one request where tiles would be a dozen.

## Esri Wayback is one release at a time

Every published release of World Imagery stays online under its own number
(`engine/wayback.py`). Same imagery, same terms and same attribution as the
default basemap, and no key. Three services, all asked only after the analyst
picks the basemap or opens its picker — and the walk follows the map from that
first open, so an analyst reading a place through time never reads the history
of where they were before:

| Service | What it answers | Notes |
|---|---|---|
| `waybackconfig.json` (S3) | every release: number, title with its date, metadata service | read once per 6 h; numbers are not in date order, so the date sorts. Only metadata services on `metadata.maptiles.arcgis.com` are followed |
| `MapServer/tilemap/{release}/{z}/{row}/{col}` | `select`: the release that tile was really published in | walking it backwards from the newest shortlists a point's changes, one small request per candidate |
| `WMTS/.../tile/{release}/{z}/{y}/{x}` | the pixels themselves | one tile per candidate, read 8 at a time, to settle the shortlist |
| `World_Imagery_Metadata_*/MapServer/{layer}/query` | `SRC_DATE2` (epoch ms), provider, satellite | layer = 23 − zoom, capped at 13. Slow, a couple of seconds each, so a walk asks up to 12 at once |

What the tilemap calls a change is a change of bytes, and Esri republishes a
picture far more often than the ground under it moves. So the pixels settle it:
each candidate's tile is reduced to a 32×32 grey thumbnail and standardised, so
a re-encoding or a new colour balance over one acquisition compares equal to it,
and two releases are one picture when under 0.5% of the thumbnail differs by
more than 0.7 of the tile's own spread. Measured against re-encoding, sharpening
and a hard gamma, none of which reaches half of that, and a roof an eighth of
the tile across, which passes it three times over. The metadata then merges what
is left: neighbours stating the same acquisition day and satellite are one
picture (observed 2026-09 in Mariupol: three releases over one GE01 acquisition
of 2023-10-04, re-coloured). Both filters keep the older release, and a tile or
a metadata answer that cannot be read is an unknown that never merges anything.

The walk runs at the view zoom, so what counts as a change scales with it: at
z19 a tile is some 75 m across and the smallest change seen is a few metres.

A tile asked of a release it did not change answers `301` to the release that
did; the proxy follows it and caches under the release asked for. The variant id
`esri-wayback~{release}` is digits only, since it becomes a path segment and a
cache directory; the plain `esri-wayback` resolves to the newest release, so its
id and its cache always name one.

## Key-less overlays

Drawn over any basemap, fetched by the browser straight from their own servers
(all answer cross-origin), never through the proxy, never cached on disk and
never in a capture. Borders are the one layer the map opens with; every other is
asked for only once its switch is on (`frontend/src/lib/map/basemap.js`).
Checked 2026-09-13.

| Layer | Source | Licence / terms | Notes |
|---|---|---|---|
| OSM labels | CARTO `voyager_only_labels` | © OSM contributors © CARTO | imagery only |
| Borders | Esri `Reference/World_Boundaries_and_Places` | Esri terms, as World Imagery | |
| Roads | Esri `Reference/World_Transportation` | Esri terms, as World Imagery | imagery only |
| OSM railways | OpenRailwayMap `standard` | © OSM contributors, style © OpenRailwayMap | |
| Power lines | Open Infrastructure Map vector tiles (`/map/power`, `/telecoms`, `/petroleum`) | data ODbL, analysis CC-BY 4.0, credit and link required | no published tile usage policy, so the style is ours, requests only follow the view, and nothing is prefetched |
| Sea marks | OpenSeaMap `seamark` | © OpenSeaMap contributors (CC-BY-SA) | |
| GPS traces | `gps.tile.openstreetmap.org/lines` | OSMF tile policy | |
| Night lights | NASA GIBS WMTS, `VIIRS_NOAA20_DayNightBand_At_Sensor_Radiance` (from 2024-03-25), `VIIRS_SNPP_…` (from 2020-11-18, with gaps), `VIIRS_Black_Marble` 2016 | public domain | Level 8 (750 m); opaque, drawn lowest at 85% |
| Active fires | NASA FIRMS, keyed, through the app | see above | |

## GeoConfirmed is a query, not a feed

An added layer (`engine/geoconfirmed.py`), not an overlay: the backend reads it
and the case keeps the copy. GeoConfirmed's public read-only API needs no key,
calls itself free to use, and asks for a User-Agent that names the integration
and for its cache headers to be respected. It states no licence, so every
layer is credited to geoconfirmed.org on the map and on each card. Checked
2026-09-19.

| Call | When | What it gives |
|---|---|---|
| `GET /api/Conflict` | the GeoConfirmed dialog opens | the public conflicts; the export is addressed by `shortName` |
| `GET /api/Conflict/{shortName}` | add, Refresh, first switch-on of a session | factions and their colours; `204` for a name it does not know |
| `POST /api/Map/export/{shortName}` | add, Refresh, first switch-on of a session | a KMZ of approved placemarks, filtered by `start`, `end` and GeoJSON `polygons`; both null for the whole history, which skips the switch-on read |

- **The KMZ over the site's own JSON.** `/api/Placemark/{c}/geojson` is 16 MB
  for Ukraine and holds no descriptions; the export is filtered server-side,
  and bundles every icon it uses (`api/icons/<colour>/<invert>/template/<n>.png`,
  56 px discs), so one request dresses the layer.
- **What the export leaves out.** No faction field: the icon path's colour is
  matched against the conflict's factions, and factions sharing a colour (Israel
  and the US on the Iran map) are one legend row. No date field: the placemark
  name is `13 SEP 2026`. Placemarks with no name are reference sites (bases,
  plants) sent whatever the dates asked for: 512 of 530 on the Iran map for
  six weeks of August and September 2026.
- **Folders are relative ages** ("B. Last 7 days"), true only on the day of the
  export, so they are dropped for the factions.
- **The hotspot is 16,16 px**, the middle of a 32 px icon, on 56 px discs. It is
  dropped and the disc centred on its point.
- **Sizes seen.** A month of Ukraine is ~800 placemarks, 83 icons and 330 kB.
  The whole Ukraine map is 60,000 placemarks and 333 icons, under both
  `MAX_FEATURES` and `MAX_ICONS`: 6.4 MB on the wire, about 4 s to read, 1.6 s
  to compose the icons and 38 MB of GeoJSON handed to the browser.

## Deliberately not basemaps

Street View and Google Photorealistic 3D Tiles are not basemap providers. They
remain separate ground-imagery and 3D-scene roadmap items.
