/**
 * What the map is made of: the imagery layer, the labels over it, and the one
 * basemap that is a live Google widget rather than a grid of our tiles.
 *
 * Everything here is engine work, which is why it sits inside `lib/map` and why
 * the tool above it only ever says *which* provider to show. The rules are the
 * expensive part and they are not obvious from the code they produce: which
 * providers go through our proxy, where a provider's pixels stop short of its
 * useful view, when a bigger tile is worth asking for, and which layer must
 * never be rebuilt because rebuilding it is billed. `tileTemplate`, `tileUrls`,
 * `sourceMaxZoom` and `rasterSource` are pure so those rules are read off tests
 * rather than off a running map (`basemap.test.js`).
 *
 * Two things the old engine needed here are gone with it, and both are worth
 * naming so nobody looks for them: a DOM grid of tiles had faint white seams at
 * fractional display scaling, which one canvas cannot have, and it refetched
 * throwaway intermediate zoom levels mid-gesture, which a billed provider paid
 * for. MapLibre overzooms what it already holds instead.
 */
import { createGoogleGlass, loadGoogleMaps } from './gmaps.js';

// A labels-only layer laid over the imagery: roads and place names readable
// without hiding the satellite view. Over a street basemap it would only
// double its own labels, which is why the tool keeps it to imagery.
const LABELS_URL =
  'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}.png';
const LABELS_ATTRIBUTION = '© OpenStreetMap contributors © CARTO';
const LABELS_MAX_ZOOM = 20;

/** What a `{s}` template is served from when the provider names no hosts. */
const DEFAULT_SUBDOMAINS = ['a', 'b', 'c'];
const LABELS_SUBDOMAINS = ['a', 'b', 'c', 'd'];

const IMAGERY = 'basemap-imagery';
const LABELS = 'basemap-labels';
/** Ours, so the first layer that is not is where the basemap stops. */
const OWNED = new Set([IMAGERY, LABELS]);

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
 * One template → the URLs the engine rotates between.
 *
 * MapLibre takes a list of hosts rather than a `{s}` pattern, so the pattern is
 * expanded here. The proxy's own template has no `{s}` and comes back as itself.
 */
export function tileUrls(template, subdomains) {
  if (!template.includes('{s}')) return [template];
  const hosts = subdomains?.length ? subdomains : DEFAULT_SUBDOMAINS;
  return hosts.map((host) => template.replace('{s}', host));
}

/**
 * The deepest tile this provider is ever asked for, counted the way the engine
 * counts tiles.
 *
 * Where a provider's pixels stop short of its useful view (Sentinel-2: native
 * z14, view z18), the engine keeps requesting the last level it has and scales
 * those tiles up. The extra zoom therefore costs nothing — asking Sentinel Hub
 * for z18 would buy its upsampling of the same pixels, 16× the tiles, every one
 * billed. A cell wider than 256 px shifts the whole grid down a level per
 * doubling, exactly as the URL zoom shifts.
 */
export function sourceMaxZoom(provider, cell) {
  const deepest = provider.max_native_zoom ?? provider.max_zoom;
  return deepest - Math.log2(cell / 256);
}

/**
 * The raster source one provider is served from, at a given cell size.
 *
 * @param {object} provider as `/api/satellite/providers` describes it
 * @param {string} providerId what the tiles are asked for — Sentinel-2 carries
 *   its layer, window and cloud ceiling in it (lib/sentinel.js)
 * @param {number} cell grid cell in CSS px (lib/usage.js `layerCell`)
 */
export function rasterSource(provider, providerId, cell) {
  return {
    type: 'raster',
    tiles: tileUrls(tileTemplate(provider, providerId), provider.subdomains),
    // Bigger tiles shift the URL zoom down (512 → -1, 1024 → -2); an oversample
    // halves the cell so each tile is shown downscaled — deeper zoom on screen.
    // Google's mid-zoom mosaics are genuinely softer than its deep ones
    // (verified), so this is what makes the paid imagery actually look paid.
    tileSize: cell,
    minzoom: 0,
    maxzoom: sourceMaxZoom(provider, cell),
    attribution: provider.attribution,
  };
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

  const map = engine.impl;
  let live = null; // `${providerId}@${cell}` currently on the map, tiles only
  // The Google widget is created ONCE and reused across basemap switches:
  // every google.maps.Map instantiation is a billed dynamic map load, while
  // hiding and showing the one we have costs nothing. Never destroyed until
  // the map goes, for the same reason.
  let glass = null;
  let labels = false;
  let wanted = null; // the provider id last asked for, so a slow load can tell
  let metered = null; // the billed provider whose tiles we are counting

  // Drawn shapes are appended by `surface.js`, so the first layer this module
  // does not own is where the basemap stops and the overlays begin.
  function ceiling() {
    return map.getLayersOrder().find((id) => !OWNED.has(id));
  }

  function onSourceData(event) {
    if (!metered || event.sourceId !== IMAGERY || !event.isSourceLoaded) return;
    // every visible tile is in, so what the proxy counted is now final
    onMeteredTiles(metered);
  }
  map.on('sourcedata', onSourceData);

  function dropTiles() {
    if (map.getLayer(IMAGERY)) map.removeLayer(IMAGERY);
    if (map.getSource(IMAGERY)) map.removeSource(IMAGERY);
    live = null;
    metered = null;
  }

  /**
   * Past its own ceiling the provider has no pixels, and the view has to stop
   * where capture sizing expects it to: `scaledCapture` reads the view zoom
   * against the provider maximum. The engine pulls the camera back itself when
   * the ceiling drops under it, which is what switching to a shallower provider
   * while zoomed deep needs.
   */
  function capZoom(provider) {
    map.setMaxZoom(provider.max_zoom - 1);
  }

  function showTiles(provider, providerId, cell) {
    dropTiles();
    capZoom(provider);
    map.addSource(IMAGERY, rasterSource(provider, providerId, cell));
    map.addLayer(
      { id: IMAGERY, type: 'raster', source: IMAGERY },
      map.getLayer(LABELS) ? LABELS : ceiling()
    );
    live = `${providerId}@${cell}`;
    if (provider.meter) {
      metered = provider;
      onMeteredTiles(provider);
    }
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
    dropTiles();
    capZoom(provider);
    if (!glass) {
      glass = createGoogleGlass(engine, {
        maxZoom: provider.max_zoom,
        attribution: provider.attribution,
      });
      onWidgetLoad(provider); // billed where it happens; the proxy cannot see it
    }
    glass.show();
  }

  function addLabels() {
    if (map.getLayer(LABELS)) return;
    map.addSource(LABELS, {
      type: 'raster',
      tiles: tileUrls(LABELS_URL, LABELS_SUBDOMAINS),
      tileSize: 256,
      minzoom: 0,
      maxzoom: LABELS_MAX_ZOOM,
      attribution: LABELS_ATTRIBUTION,
    });
    map.addLayer(
      {
        id: LABELS,
        type: 'raster',
        source: LABELS,
        // Past its own last level the overlay stops rather than being blown up:
        // a road name upscaled four times over a rooftop is a smear, and this
        // is what the map before it did. The two ceilings are the same number
        // and different questions — the source's is the deepest tile, the
        // layer's is the deepest view, which the engine counts one shallower.
        maxzoom: LABELS_MAX_ZOOM,
      },
      // above the imagery, below anything a tool draws
      ceiling()
    );
  }

  function dropLabels() {
    if (map.getLayer(LABELS)) map.removeLayer(LABELS);
    if (map.getSource(LABELS)) map.removeSource(LABELS);
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
      glass?.hide();
      // Already the live layer — leave it alone. Returning to this tab refetches
      // the providers, and the fresh objects re-run the layer effect, so this is
      // the common path rather than an edge case; rebuilding it would drop and
      // refetch every visible tile, which reads on screen as a reloading map.
      // The cell is part of the answer: an oversampled provider changes it at
      // one zoom bracket, and that is a different grid of the same tiles.
      if (live === `${providerId}@${cell}`) {
        capZoom(provider);
        return;
      }
      showTiles(provider, providerId, cell);
    },

    setLabels(on) {
      if (on === labels) return;
      labels = on;
      if (on) addLabels();
      else dropLabels();
    },

    dispose() {
      map.off('sourcedata', onSourceData);
      glass?.destroy();
      glass = null;
    },
  };
}
