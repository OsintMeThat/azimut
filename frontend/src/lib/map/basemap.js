/**
 * What the map is made of: the imagery layer, the labels over it, and the one
 * basemap that is a live Google widget rather than a grid of our tiles.
 *
 * Everything here is engine work, which is why it sits inside `lib/map` and why
 * the tool above it only ever says *which* provider to show. The rules are the
 * expensive part and they are not obvious from the code they produce: which
 * providers go through our proxy, where a provider's pixels stop short of its
 * useful view, when a bigger tile is worth asking for, and which layer must
 * never be rebuilt because rebuilding it is billed. `tileTemplate` and
 * `tileLayerOptions` are pure so those rules are read off tests rather than
 * off a running map (`basemap.test.js`).
 */
import L from 'leaflet';
import { createSatelliteMutant, loadGoogleMaps } from './gmaps.js';

// A labels-only layer laid over the imagery: roads and place names readable
// without hiding the satellite view. Over a street basemap it would only
// double its own labels, which is why the tool keeps it to imagery.
const LABELS_URL =
  'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}.png';
const LABELS_ATTRIBUTION = '© OpenStreetMap contributors © CARTO';

/**
 * Where a provider's tiles are fetched from.
 *
 * Every provider goes through the backend tile proxy: keys and session tokens
 * stay server-side, every billed tile is counted exactly once (browser cache
 * hits never reach the proxy), cacheable providers share the disk tile cache,
 * and coverage gaps come back overzoomed instead of as "not yet available"
 * placards. Only `{s}` subdomain templates (custom providers) stay direct —
 * the proxy cannot expand those.
 */
export function tileTemplate(provider, providerId) {
  return provider.url.includes('{s}') ? provider.url : `/api/tiles/${providerId}/{z}/{x}/{y}`;
}

/**
 * The grid options one provider is shown with, at a given cell size.
 *
 * @param {object} provider as `/api/satellite/providers` describes it
 * @param {number} cell grid cell in CSS px (lib/usage.js `layerCell`)
 */
export function tileLayerOptions(provider, cell) {
  // maxZoom caps the map itself (no map-level maxZoom is set), which is what
  // keeps a shallower provider (OpenTopoMap, z17) from ever being asked for
  // tiles it would answer with a "max zoom layer" placard — and keeps the
  // view zoom at or under the provider max, which capture sizing relies on.
  const options = { attribution: provider.attribution, maxZoom: provider.max_zoom };
  // Where a provider's pixels stop short of its useful view (Sentinel-2:
  // native z14, view z18), the engine keeps requesting the native level and
  // scales those tiles up in CSS. The extra zoom therefore costs nothing —
  // asking Sentinel Hub for z18 would buy its upsampling of the same pixels,
  // 16× the tiles, every one billed.
  if (provider.max_native_zoom != null) options.maxNativeZoom = provider.max_native_zoom;
  // Bigger tiles offset the URL z down (512 → -1, 1024 → -2); an oversample
  // halves the cell so each tile is shown downscaled — deeper zoom on screen.
  // Google's mid-zoom mosaics are genuinely softer than its deep ones
  // (verified), so this is what makes the paid imagery actually look paid.
  if (cell !== 256 || provider.tile_size > 256) {
    options.tileSize = cell;
    options.zoomOffset = -Math.log2(cell / 256);
    options.minNativeZoom = 0; // never ask for negative URL z at world zooms
  }
  if (provider.meter) {
    // billed tiles: skip the throwaway fetches made mid-zoom-animation
    // (intermediate zoom levels that get discarded). Deliberately NOT
    // updateWhenIdle: it delays sharp tiles until the map fully settles,
    // leaving the scaled-up previous zoom (visible blur) on screen — and it
    // saves nothing, since each visible tile is only ever fetched once.
    options.updateWhenZooming = false;
    options.keepBuffer = 4;
  }
  return options;
}

/**
 * Own the layers of one map.
 *
 * The callbacks are the app's business, not the map's: what a billed layer does
 * to the usage pill, what a rejected key does to Settings and to the selector.
 *
 * @param {object} engine the façade from `engine.js`
 * @param {object} [hooks]
 * @param {(provider: object) => void} [hooks.onMeteredTiles] a billed layer painted
 * @param {(provider: object) => void} [hooks.onWidgetLoad] a billed map load happened
 * @param {(provider: object) => void} [hooks.onWidgetAuthFailure] Google rejected the key
 * @param {(provider: object, error: Error) => void} [hooks.onWidgetFailed] the script never loaded
 */
export function createBasemaps(engine, hooks = {}) {
  const {
    onMeteredTiles = () => {},
    onWidgetLoad = () => {},
    onWidgetAuthFailure = () => {},
    onWidgetFailed = () => {},
  } = hooks;

  let live = null; // the imagery layer currently on the map
  // The Google widget layer is created ONCE and reused across basemap
  // switches: every google.maps.Map instantiation is a billed dynamic map
  // load, while re-adding the same layer costs nothing. Never destroyed
  // until the map goes, for the same reason.
  let widgetLayer = null;
  let labelsLayer = null;
  let wanted = null; // the provider id last asked for, so a slow load can tell

  // --- tile seam fix ---
  // The engine positions each tile with a `translate3d(...)` transform, which
  // promotes it to its own GPU layer. At fractional OS display scaling (e.g.
  // 125/150%) an integer CSS position lands on a half physical pixel, so every
  // tile edge is antialiased independently and bleeds the map background as a
  // faint white grid — browser- and zoom-independent. Painting tiles with plain
  // left/top (no transform, no backface-visibility promotion — see the tool's
  // CSS) keeps them in the shared pane layer, where neighbouring edges meet on
  // whole pixels. Rotation/zoom still use their own pane transforms, so both
  // keep working. We convert after the tiles are positioned, and revert to
  // transform positioning just before a zoom so the reposition is glitch-free.
  //
  // A DOM grid of tiles is what makes this both possible and necessary: an
  // engine that paints its tiles into one canvas has neither the seam nor the
  // hook, and this whole block goes with it.
  let seamRaf = 0;

  function tiles() {
    return engine.container?.querySelectorAll('.leaflet-tile') ?? [];
  }

  function deSeamTiles() {
    seamRaf = 0;
    for (const tile of tiles()) {
      const at = /translate3d\((-?[\d.]+)px,\s*(-?[\d.]+)px/.exec(tile.style.transform);
      if (!at) continue; // already flat, or a rotated matrix we shouldn't touch
      tile.style.left = at[1] + 'px';
      tile.style.top = at[2] + 'px';
      tile.style.transform = 'none';
    }
  }

  function scheduleDeSeam() {
    if (!seamRaf) seamRaf = requestAnimationFrame(deSeamTiles);
  }

  // put the translate transform back before the tiles are repositioned for a
  // new zoom, so a tile is never briefly offset by both left/top and translate3d
  function reSeamTiles() {
    for (const tile of tiles()) {
      if (tile.style.transform === 'none' && tile.style.left) {
        tile.style.transform = `translate3d(${tile.style.left}, ${tile.style.top}, 0)`;
        tile.style.left = '';
        tile.style.top = '';
      }
    }
  }

  const unsubscribe = [
    engine.on('view-settled', scheduleDeSeam),
    engine.on('view-reset', scheduleDeSeam),
    engine.on('zoom-start', reSeamTiles),
  ];

  /**
   * Past its maxZoom the engine drops a grid layer entirely rather than upscale
   * it, so switching to a shallower provider (OpenTopoMap, z17) while zoomed
   * deeper would leave a blank map. Pull the view back to what it can serve.
   */
  function clampToProvider(provider) {
    if (engine.getZoom() > provider.max_zoom) engine.setZoom(provider.max_zoom);
  }

  async function showWidget(provider) {
    try {
      await loadGoogleMaps(provider.url, {
        // Google's only key-rejection signal — it can fire minutes after a
        // clean load, so the caller handles it as a runtime event.
        onAuthFailure: () => onWidgetAuthFailure(provider),
      });
    } catch (error) {
      onWidgetFailed(provider, error);
      return;
    }
    if (wanted !== provider.id) return; // user moved on while loading
    if (!widgetLayer) {
      widgetLayer = createSatelliteMutant(provider.max_zoom, provider.attribution);
      onWidgetLoad(provider); // billed where it happens; the proxy cannot see it
    }
    // Already the live layer — leave it alone. Returning to this tab refetches
    // the providers, and the fresh objects re-run the layer effect, so this is
    // the common path rather than an edge case. Re-adding costs no map load
    // (the mutant reuses its google.maps.Map), but the engine drops and
    // re-clones every tile in the grid, which reads on screen as a reloading map.
    if (live === widgetLayer) return;
    live?.remove();
    clampToProvider(provider);
    live = widgetLayer.addTo(engine.leaflet);
  }

  function showTiles(provider, providerId, cell) {
    live?.remove();
    clampToProvider(provider);
    const layer = L.tileLayer(tileTemplate(provider, providerId), tileLayerOptions(provider, cell));
    live = layer.addTo(engine.leaflet);
    layer.on('load tileload', scheduleDeSeam);
    if (provider.meter) {
      onMeteredTiles(provider);
      // 'load' fires once all visible tiles are in — keep the pill current
      layer.on('load', () => onMeteredTiles(provider));
    }
  }

  return {
    /**
     * Show one provider. `providerId` carries Sentinel-2's layer, window and
     * cloud ceiling (lib/sentinel.js), so it is what the tiles are asked for
     * and never the bare provider id.
     */
    show(provider, providerId, cell) {
      wanted = provider?.id ?? null;
      if (!provider) return;
      if (provider.widget) {
        showWidget(provider);
        return;
      }
      showTiles(provider, providerId, cell);
    },

    setLabels(on) {
      if (on && !labelsLayer) {
        labelsLayer = L.tileLayer(LABELS_URL, {
          subdomains: 'abcd',
          maxZoom: 20,
          pane: 'overlayPane', // above the imagery tiles, below markers/controls
          attribution: LABELS_ATTRIBUTION,
        }).addTo(engine.leaflet);
        labelsLayer.on('load tileload', scheduleDeSeam); // keep the overlay seam-free too
      } else if (!on && labelsLayer) {
        labelsLayer.remove();
        labelsLayer = null;
      }
    },

    dispose() {
      for (const off of unsubscribe) off();
      if (seamRaf) cancelAnimationFrame(seamRaf);
      seamRaf = 0;
    },
  };
}
