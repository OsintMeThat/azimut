# Keyed imagery providers — Mapbox & Google (implementation brief)

> Build spec for a future agent. Goal: let a user add their **own** Mapbox and
> Google Maps Platform API keys in-app, then select **Mapbox Satellite** and
> **Google Satellite** as basemaps in the Satellite tab — with every existing tool
> (rotate, measure, capture, reference windows) working over them exactly like Esri.
>
> Read alongside SPEC.md §6 "v1 notes → Tile providers" (legal-only policy) and the
> tile engine [`src/azimut/engine/tiles.py`](../src/azimut/engine/tiles.py).

## 0. Non-negotiable legal rules (decided — do not relax)

These come from Google's and Mapbox's terms; they drive the whole design.

| Rule | Why |
|------|-----|
| Keys are **user-supplied**, stored **locally**, **never** bundled into a shared case/zip. | Principle 7; keys are the user's own billing identity. |
| Core features never require a key. Key-less providers (Esri, OSM) stay the default. | Principle 7. |
| **Never** ship/suggest/document unofficial endpoints (`mt1.google.com`, `khms*`, …). Only official APIs. | Existing legal-only policy. |
| **Google tiles must NOT be cached to disk.** Google's Map Tiles API forbids pre-fetch/store/cache/offline use of tiles. | [Map Tiles API Policies](https://developers.google.com/maps/documentation/tile/policies). |
| A Google **capture** is allowed only as a **flattened, attributed screenshot** (single PNG, attribution burned in). It must never be a store of raw tiles. | Google Geo Guidelines permit screenshots in reports/periodicals ≤5,000 copies **with attribution**; the anti-cache clause forbids tile hoarding. The two are different acts. |
| Every capture keeps provider **attribution** (Google/Mapbox + data providers, e.g. Maxar) unmodified. For Google it is **burned into the image footer** (non-optional). | Attribution is a condition of the allowed use, not a courtesy. |

### Per-provider capability matrix (the model to encode)

| Provider | `needs_key` | auth style | `capturable` | `cacheable` (tile disk cache) | attribution source |
|----------|:-----------:|------------|:------------:|:-----------------------------:|--------------------|
| Esri World Imagery | no | — | yes | yes | static string (current) |
| OpenStreetMap | no | — | yes | yes | static string (current) |
| **Mapbox Satellite** | yes | access token in URL | yes | yes¹ | `© Mapbox © OpenStreetMap` (+ Maxar) |
| **Google Satellite** | yes | **session token** | yes (flattened+attributed only) | **NO** | dynamic copyright from viewport endpoint |

¹ Mapbox: display + static-image capture with attribution is permitted; verify the
user's plan-level caching/redistribution limits before enabling an aggressive
persistent cache. Default to a modest cache, attribution always on.

## 1. Data model — `settings.json`

Extend `DEFAULT_SETTINGS` in [`src/azimut/config.py`](../src/azimut/config.py). `api_keys`
already exists; add first-class keyed providers and usage counters so the user
doesn't hand-write XYZ templates.

```jsonc
{
  "api_keys": {
    "mapbox": "pk.....",              // Mapbox public access token
    "google": "AIza...."              // Google Maps Platform API key
  },
  "tile_providers": [ /* still supported for custom/self-hosted XYZ */ ],
  "usage": {                          // per-provider monthly counters (§6)
    "google":  { "2026-07": 1234 },
    "mapbox":  { "2026-07": 87 }
  }
}
```

Keep back-compat: a user with only `api_keys.mapbox`/`google` set gets the built-in
keyed providers below automatically — no `tile_providers` entry needed.

## 2. Provider model — `tiles.py`

Extend the `Provider` dataclass with the capability flags and an optional
session-token hook:

```python
@dataclass(frozen=True)
class Provider:
    # ...existing fields...
    capturable: bool = True          # may a saved capture be filed from it?
    cacheable: bool = True           # may its tiles be written to a disk cache?
    attribution_burn: bool = False   # force attribution stamped into the image
    session: str | None = None       # provider kind needing a token: "google"
```

`all_providers()` gains the built-in keyed providers when the matching key is
present in `api_keys`:

- **Mapbox Satellite** — `capturable=True, cacheable=True`
  URL: `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/tiles/512/{z}/{x}/{y}?access_token={key}`
  (`satellite-streets-v12` for a labelled variant; `max_zoom=22`, `imagery=True`).
  **512px tiles, not 256**: Mapbox bills 256px tiles 4× vs 512px for the same
  ground area at the same m/px (one 512 tile at z-1 = four 256 tiles at z).
- **Google Satellite** — `capturable=True, cacheable=False, attribution_burn=True, session="google"`, `imagery=True`, `max_zoom=22`. URL template resolved at fetch time (needs a live session token, see §3).

`fetch_crop` / the frontend tile layer must:
- refuse to build a saved capture when `provider.capturable is False` (none today, but the flag must gate the code path);
- skip the disk cache entirely when `provider.cacheable is False`;
- stamp attribution into the footer when `attribution_burn is True` (route it into the existing Proof Composer/capture footer, and ensure the Satellite capture PNG itself carries it).

## 3. Google Map Tiles API — session-token adapter

Google is **not** a static `{key}` URL. Add a small adapter (e.g.
`src/azimut/engine/google_tiles.py`) that mints and caches a session token, then
hands the rest of the pipeline a normal XYZ template.

1. **Create session** (once, cache it):
   `POST https://tile.googleapis.com/v1/createSession?key={API_KEY}`
   body: `{"mapType":"satellite","language":"en-US","region":"US"}`
   → `{"session":"<token>","expiry":"<unix>","tileWidth":256,"tileHeight":256,"imageFormat":"jpeg"}`
2. **Tiles** (standard slippy XYZ):
   `GET https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session={token}&key={API_KEY}`
3. **Refresh** the token when `expiry` passes (or on 401/403), transparently.
4. **Attribution**: fetch the viewport copyright string and display/burn it:
   `GET https://tile.googleapis.com/tile/v1/viewport?session={token}&key={API_KEY}&zoom={z}&north=&south=&east=&west=`
   → `copyright` field (e.g. `"Map data ©2026 Google, Maxar Technologies"`). Do not
   reduce it to just "Google".
5. Cache the token in memory (and optionally a short-lived on-disk token file — the
   **token**, never tiles). Session params (mapType) are part of the token identity.

Both the live Leaflet layer and backend `fetch_crop` consume the resolved URL from
step 2 — so once the token exists, Google behaves like any XYZ provider and all
tools work unchanged.

## 4. Frontend — API keys settings tab

New settings/options page (SPEC §7 "Settings & secrets"). Minimal:

- Fields: **Mapbox token**, **Google Maps Platform key** — saved to `api_keys`.
  Password-style inputs, "how to get one" help links, per-key **test** button
  (Mapbox: fetch one tile; Google: `createSession`).
- Keys are app-wide (not per-case). Never written into a case folder or export bundle.
- On save, the keyed providers appear in the Satellite basemap selector automatically.

### Basemap selector behaviour (Satellite tab)

- The bottom-of-map basemap picker lists all `all_providers()`, keyed ones included.
- When the selected provider has `capturable=False`, **disable the capture button**
  with a tooltip ("view-only basemap"). (No built-in provider is view-only today,
  but wire the gate now.)
- Google + Mapbox render in the live Leaflet map via `L.tileLayer(resolvedUrl)`;
  keep the existing rotate/measure/reference-window behaviour untouched.

## 5. Tile disk cache (respect `cacheable`)

If/when a disk tile cache lands (SPEC §9 open question):
- Cache tiles **only** for `cacheable=True` providers (Esri, OSM, Mapbox).
- **Never** cache Google tiles — re-fetch each time; lean on the monthly counter to
  stay in free tier. Honour any `Cache-Control` headers Google returns.

## 6. Monthly usage counter

SPEC §7 already promises per-provider monthly counters. Implement here because
keyed providers are billed:

- Increment `usage.<provider>.<YYYY-MM>` per outbound tile request (Google, Mapbox).
- Surface a small readout in the settings tab and near the basemap selector
  ("Google: 12,430 tiles this month").
- Optional soft cap: warn / block new fetches when a user-set monthly limit is hit
  (protects the free tier; for Google it also limits exposure).
- Counting is local bookkeeping only — no telemetry (principle 1).
- Billing units verified (2026-07): both bill **per tile served** — Google 2D Map
  Tiles SKU = "Request that returns a 2D map tile" (sessions are free), Mapbox
  Static Tiles = per tile request when used with Leaflet. Free tiers: Google
  100k/month, Mapbox 200k/month. Metered tiles are proxied through the backend
  so the counter matches billing exactly (browser cache hits never re-count).

## 7. Tests (required — repo rule)

- `tiles.py`: keyed providers appear in `all_providers()` only when their key is
  present; `capturable`/`cacheable` flags parsed and defaulted correctly.
- `google_tiles.py`: session token minted, cached, and refreshed on expiry
  (mock the HTTP calls — no real network); viewport copyright parsed.
- Capture path: `capturable=False` blocks a saved capture; `attribution_burn=True`
  stamps the footer; `cacheable=False` bypasses the cache.
- Usage counter increments per month key and rolls over correctly.
- Back-compat: existing Esri/OSM capture tests stay green.

## 8. Out of scope (future, separate specs)

- **Street View** (Google Street View Static API) — a distinct ground-imagery tool,
  not a basemap; already sketched in SPEC §v2 "Ground Imagery".
- **Google Photorealistic 3D Tiles** — needs a WebGL engine (MapLibre/Cesium), lands
  only after the MapLibre migration (SPEC §7); a 3D scene, not a flat capture.
- **Mapillary**