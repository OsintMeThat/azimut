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
import { INFRASTRUCTURE } from './infrastructure.js';
import { tileTemplate as nightTemplate } from './nightlights.js';

/** What a `{s}` template is served from when the provider names no hosts. */
const DEFAULT_SUBDOMAINS = ['a', 'b', 'c'];

const IMAGERY = 'basemap-imagery';
/** A second picture of the same ground, laid just over the first (`setAlternate`). */
const ALTERNATE = 'basemap-alternate';

/**
 * What can be laid over the imagery, in the order they stack — first is
 * lowest, and the imagery goes under all of them.
 *
 * Each is asked for only once the analyst switches it on: a map that is not
 * showing railways fetches no railway tiles. The key-less ones are fetched
 * straight from their own servers, which all answer cross-origin, and none of
 * them is billed. FIRMS is the exception and goes through the app, which is
 * where its key lives.
 *
 * Order matters on screen. The night picture is opaque, so it sits lowest and
 * everything reads over it. Then lines over the picture, point marks over the
 * lines, names over all of them (a station name under its own track is a name
 * nobody reads), and the fires last, because when that layer is on it is the
 * subject.
 *
 * `url` may be a function, for a layer whose address is a question rather than
 * a constant: FIRMS answers for one sensor over one window, the night lights
 * for one night, and changing either is a different set of tiles.
 *
 * `vector` is a layer drawn from vector tiles by a style of our own: several
 * sources and several engine layers, switched on and off as one.
 */
const OVERLAYS = [
  {
    // One night photographed from orbit, or the 2016 baseline (nightlights.js).
    // Key-less and public domain. Magnified past its 750 m pixels rather than
    // cut off, because which district went dark is read zoomed in.
    id: 'nightlights',
    layer: 'basemap-nightlights',
    url: nightTemplate,
    attribution: 'Night lights: NASA EOSDIS GIBS, VIIRS',
    maxZoom: 8,
    // The native product is coarse, but it remains useful as a translucent
    // context layer while reading a street or site at a deeper map zoom.
    viewMaxZoom: 24,
    // just enough of the ground through it to tell which street is lit
    opacity: 0.85,
  },
  {
    // The raw GPS traces people uploaded to OSM: tracks nobody mapped yet, and
    // how a site is really driven into.
    id: 'gpstraces',
    layer: 'basemap-gpstraces',
    url: 'https://gps.tile.openstreetmap.org/lines/{z}/{x}/{y}.png',
    attribution: 'GPS traces © OpenStreetMap contributors',
    maxZoom: 20,
  },
  {
    // Esri's road reference, drawn for imagery like the labels are.
    id: 'roads',
    layer: 'basemap-roads',
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Esri, HERE, Garmin, © OpenStreetMap contributors',
    maxZoom: 19,
  },
  {
    // Tracks, yards and stations, drawn as lines over whatever is underneath —
    // the one OSM rendering that says which of two parallel strips is a railway.
    id: 'railway',
    layer: 'basemap-railway',
    url: 'https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png',
    subdomains: ['a', 'b', 'c'],
    attribution: '© OpenStreetMap contributors · style © OpenRailwayMap',
    maxZoom: 19,
  },
  {
    id: 'power',
    layer: 'basemap-power',
    vector: INFRASTRUCTURE,
    attribution: '© OpenStreetMap contributors · Open Infrastructure Map (CC-BY)',
  },
  {
    // Buoys, lights, harbours and fairways: the sea's own signage.
    id: 'seamarks',
    layer: 'basemap-seamarks',
    url: 'https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png',
    attribution: '© OpenSeaMap contributors',
    maxZoom: 18,
  },
  {
    // Country, region and district borders with their names. Esri's, under the
    // same terms as the World Imagery the app already shows.
    id: 'boundaries',
    layer: 'basemap-boundaries',
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Esri, HERE, Garmin, © OpenStreetMap contributors, and the GIS user community',
    maxZoom: 19,
  },
  {
    // Active fire detections, live or from the archive (engine/firms.py). The
    // key is NASA's and stays on the backend, so this one address is ours.
    id: 'firms',
    layer: 'basemap-firms',
    url: (params) => `/api/firms/tiles/{z}/{x}/{y}?${new URLSearchParams(params)}`,
    attribution: 'Active fire data: NASA FIRMS',
    // The source stops at z14. Past it, MapLibre enlarges those pixels instead
    // of requesting invented detail, so a detection remains a visible square.
    maxZoom: 14,
    viewMaxZoom: 24,
    resampling: 'nearest',
  },
];

/** The ids a surface can be asked to show, so nothing hard-codes the list. */
export const OVERLAY_IDS = OVERLAYS.map((overlay) => overlay.id);

/**
 * The engine layers one overlay is drawn as, lowest first. A raster overlay is
 * one; a vector overlay is one per entry of its style.
 */
export function overlayLayers(overlay) {
  if (!overlay.vector) return [overlay.layer];
  return overlay.vector.layers.map((entry) => `${overlay.layer}-${entry.id}`);
}

/** …and the sources behind them, as `[id, spec]`. */
export function overlaySources(overlay, params) {
  const { attribution } = overlay;
  if (overlay.vector) {
    return Object.entries(overlay.vector.sources).map(([name, url]) => [
      `${overlay.layer}-${name}`,
      { type: 'vector', tiles: [url], minzoom: 0, maxzoom: overlay.vector.maxZoom, attribution },
    ]);
  }
  const template = typeof overlay.url === 'function' ? overlay.url(params ?? {}) : overlay.url;
  return [
    [
      overlay.layer,
      {
        type: 'raster',
        tiles: tileUrls(template, overlay.subdomains),
        tileSize: 256,
        minzoom: 0,
        maxzoom: overlay.maxZoom,
        attribution,
      },
    ],
  ];
}

/** Ours, so the first layer that is not is where the basemap stops. */
const OWNED = new Set([IMAGERY, ALTERNATE, ...OVERLAYS.flatMap(overlayLayers)]);

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
  // The overlays currently laid over the imagery, each against the question it
  // was built to answer (null for the ones that are simply on or off).
  const shown = new Map();
  let wanted = null; // the provider id last asked for, so a slow load can tell
  let metered = null; // the billed provider whose tiles we are counting
  let current = null; // the provider the zoom cap was last taken from
  let sharedCeiling = null; // a view zoom this map must not pass, whatever it shows
  let alternate = null; // `${providerId}@${cell}` of the second picture, when there is one
  let alternateMetered = null;
  let alternateOn = false;

  // Drawn shapes are appended by `surface.js`, so the first layer this module
  // does not own is where the basemap stops and a tool's own marks begin.
  function ceiling() {
    return map.getLayersOrder().find((id) => !OWNED.has(id));
  }

  /** Whether an overlay is on the map, read off its lowest layer. */
  function isUp(overlay) {
    return Boolean(map.getLayer(overlayLayers(overlay)[0]));
  }

  /** The lowest overlay that is up, which is what the imagery goes under. */
  function lowestOverlay() {
    const up = OVERLAYS.find(isUp);
    return up ? overlayLayers(up)[0] : ceiling();
  }

  /**
   * Where one overlay is inserted: under the first overlay declared above it
   * that is already up, so the stack holds however they are switched on.
   */
  function under(overlay) {
    const above = OVERLAYS.slice(OVERLAYS.indexOf(overlay) + 1).find(isUp);
    return above ? overlayLayers(above)[0] : ceiling();
  }

  function onSourceData(event) {
    if (!event.isSourceLoaded) return;
    // every visible tile is in, so what the proxy counted is now final
    const billed = event.sourceId === IMAGERY ? metered : event.sourceId === ALTERNATE ? alternateMetered : null;
    if (billed) onMeteredTiles(billed);
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
    current = provider;
    // A map linked to another one stops where the shallower of the two does,
    // or the deeper one would pull its partner's camera past its pixels.
    const deepest = Math.min(provider.max_zoom, sharedCeiling ?? Infinity);
    map.setMaxZoom(deepest - 1);
  }

  function showTiles(provider, providerId, cell) {
    dropTiles();
    capZoom(provider);
    map.addSource(IMAGERY, rasterSource(provider, providerId, cell));
    map.addLayer({ id: IMAGERY, type: 'raster', source: IMAGERY },
      map.getLayer(ALTERNATE) ? ALTERNATE : lowestOverlay());
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

  function addOverlay(overlay, params) {
    if (isUp(overlay)) return;
    for (const [id, spec] of overlaySources(overlay, params)) map.addSource(id, spec);
    const before = under(overlay);
    if (overlay.vector) {
      for (const entry of overlay.vector.layers) {
        map.addLayer(
          { ...entry, id: `${overlay.layer}-${entry.id}`, source: `${overlay.layer}-${entry.source}` },
          before
        );
      }
      return;
    }
    const paint = {};
    if (overlay.opacity != null) paint['raster-opacity'] = overlay.opacity;
    if (overlay.resampling) paint['raster-resampling'] = overlay.resampling;
    map.addLayer(
      {
        id: overlay.layer,
        type: 'raster',
        source: overlay.layer,
        // Past its own last level the overlay stops rather than being blown up:
        // a road name upscaled four times over a rooftop is a smear, and this
        // is what the map before it did. The two ceilings are the same number
        // and different questions — the source's is the deepest tile, the
        // layer's is the deepest view, which the engine counts one shallower.
        // A picture whose coarse pixels are still worth reading zoomed in
        // states a deeper view of its own.
        maxzoom: overlay.viewMaxZoom ?? overlay.maxZoom,
        ...(Object.keys(paint).length ? { paint } : {}),
      },
      before
    );
  }

  function dropOverlay(overlay) {
    for (const id of overlayLayers(overlay)) if (map.getLayer(id)) map.removeLayer(id);
    for (const [id] of overlaySources(overlay, {})) if (map.getSource(id)) map.removeSource(id);
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

    /**
     * Lay one overlay over the imagery, or take it off (`OVERLAY_IDS`).
     *
     * Idempotent, because the surface re-states every overlay whenever one of
     * them changes: switching the railways on must not rebuild the labels, and
     * a rebuilt raster layer is every visible tile refetched.
     *
     * `params` is for a layer that is a question — FIRMS's sensor and window.
     * A different question is a different set of tiles, so that one *is*
     * rebuilt, and only when the answer it was built with has changed.
     */
    setOverlay(id, on, params) {
      const overlay = OVERLAYS.find((entry) => entry.id === id);
      if (!overlay) return;
      const asked = on ? JSON.stringify(params ?? null) : null;
      if (asked === (shown.get(id) ?? null)) return;
      if (shown.has(id)) {
        shown.delete(id);
        dropOverlay(overlay);
      }
      if (on) {
        shown.set(id, asked);
        addOverlay(overlay, params);
      }
    },

    /**
     * Lay a second picture of the same ground just over the imagery, or take it
     * off with a null provider. It is drawn transparent until `showAlternate`,
     * so blinking between the two flips a paint property and never reloads a
     * tile: both pictures stay loaded the whole time. A widget basemap has no
     * tiles to lay, so it is refused.
     */
    setAlternate(provider, providerId, cell) {
      const key = provider && !provider.widget ? `${providerId}@${cell}` : null;
      if (key === alternate) return;
      if (map.getLayer(ALTERNATE)) map.removeLayer(ALTERNATE);
      if (map.getSource(ALTERNATE)) map.removeSource(ALTERNATE);
      alternate = key;
      alternateMetered = null;
      if (!key) return;
      map.addSource(ALTERNATE, rasterSource(provider, providerId, cell));
      map.addLayer({
        id: ALTERNATE,
        type: 'raster',
        source: ALTERNATE,
        paint: {
          'raster-opacity': alternateOn ? 1 : 0,
          'raster-opacity-transition': { duration: 0, delay: 0 },
          'raster-fade-duration': 0,
        },
      }, lowestOverlay());
      if (provider.meter) {
        alternateMetered = provider;
        onMeteredTiles(provider);
      }
    },

    /** Show the second picture over the first, or let the first through again. */
    showAlternate(on) {
      alternateOn = Boolean(on);
      if (map.getLayer(ALTERNATE)) map.setPaintProperty(ALTERNATE, 'raster-opacity', alternateOn ? 1 : 0);
    },

    /**
     * Cap the view zoom below the provider's own ceiling, or lift that cap with
     * null. Compare hands both of its maps the shallower of their two ceilings.
     */
    setZoomCeiling(value) {
      sharedCeiling = Number.isFinite(value) ? value : null;
      if (current) capZoom(current);
    },

    dispose() {
      map.off('sourcedata', onSourceData);
      glass?.destroy();
      glass = null;
    },
  };
}
