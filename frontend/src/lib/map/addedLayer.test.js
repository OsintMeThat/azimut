// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import {
  colourExpression,
  badgeImage,
  markerImageKey,
  createAddedLayer,
  featureAt,
  featureExtent,
  iconName,
  markerIcon,
  kindOf,
  periodFilter,
  registerIcons,
  visibilityFilter,
} from './addedLayer.js';
import { PALETTE } from './addedLayers.js';
import symbols from './layerSymbols.json';
import { BADGE_GLYPHS } from './markerGlyphs.js';

describe('personal marker symbols', () => {
  it('draws every round pictogram from its own glyph, and no badge for a plain marker', () => {
    const drawn = [];
    vi.stubGlobal('Path2D', class { constructor(path) { drawn.push(path); } });
    const context = { clearRect: vi.fn(), setTransform: vi.fn(), translate: vi.fn(), rotate: vi.fn(),
      fill: vi.fn(), stroke: vi.fn(), getImageData: vi.fn(() => ({ width: 64 })) };
    const make = () => ({ getContext: () => context });
    try {
      for (const symbol of symbols.filter((entry) => entry.id.startsWith('badge-'))) {
        drawn.length = 0;
        expect(badgeImage(symbol.id, '#009e73', {}, make)).toEqual({ width: 64 });
        // the halo and the disc, then the glyph's own layers in order
        expect(drawn.slice(2)).toEqual(BADGE_GLYPHS[symbol.id].map(([, d]) => d));
      }
      expect(badgeImage('star', '#009e73', {}, make)).toBeNull();
    } finally { vi.unstubAllGlobals(); }
  });
  it('uses the chosen app symbol on a point and keeps shapes on their own symbols', () => {
    expect(markerIcon({ type: 'Point' }, 'star')).toBe(iconName('star'));
    expect(markerIcon({ type: 'Point' }, 'pin')).toBe(iconName('point'));
    expect(markerIcon({ type: 'Polygon' }, 'star')).toBe(iconName('area'));
    expect(markerIcon({ type: 'Point' }, 'unknown')).toBe(iconName('point'));
  });

  it('registers a round icon in its colour and gives personal points a filtered click target', async () => {
    const engine = stubEngine();
    const buildBadge = vi.fn(() => ({ width: 64, height: 64, data: new Uint8Array(64 * 64 * 4) }));
    const layer = createAddedLayer(engine, { editable: true, buildBadge });
    await layer.set({ type: 'FeatureCollection', features: [{ type: 'Feature',
      geometry: { type: 'Point', coordinates: [2, 48] },
      properties: { index: 0, category: 'Reviewed', colour: '#009e73', symbol: 'badge-building' } }] });
    expect(buildBadge).toHaveBeenCalledWith('badge-building', '#009e73', { status: '', external: false });
    const source = [...engine.map.sources.values()][0].data.features[0];
    expect(source.properties.$badge).toBe(true);
    expect(source.properties.$own).toContain('badge-building-009e73');
    const hit = [...engine.map.layers.values()].find((entry) => entry.id.endsWith('-hit-own'));
    expect(hit.paint['circle-radius']).toEqual(['max', 10, ['*', ['case', ['has', '$native'], 22, 13], ['coalesce', ['get', 'icon_scale'], 1]]]);
    layer.filter(['Reviewed']);
    expect(engine.map.getLayer(hit.id).filter).toContainEqual(['!', ['in', ['get', 'category'], ['literal', ['Reviewed']]]]);
    expect([...engine.map.layers.values()].find((entry) => entry.id.endsWith('-mark')).layout['icon-allow-overlap']).toBe(true);
  });

  it('opens only the upper layer when two personal layers share a point', async () => {
    const engine = stubEngine();
    const first = stubCard(), second = stubCard();
    const a = createAddedLayer(engine, { ...first.opts, editable: true });
    const b = createAddedLayer(engine, { ...second.opts, editable: true });
    const point = { type: 'Feature', geometry: { type: 'Point', coordinates: [2, 48] },
      properties: { index: 0, name: 'Shared gate' } };
    await a.set({ type: 'FeatureCollection', features: [point] });
    await b.set({ type: 'FeatureCollection', features: [point] });
    const ids = [...engine.map.layers.keys()].filter((id) => id.endsWith('-hit'));
    let top = ids[1];
    engine.map.queryRenderedFeatures = vi.fn(() => [{ ...point, layer: { id: top } }]);
    const click = () => {
      for (const [type, , handler] of engine.map.handlers) if (type === 'click') {
        handler({ features: [point], point: { x: 10, y: 10 }, lngLat: { lat: 48, lng: 2 } });
      }
    };
    click();
    expect(first.card).not.toHaveBeenCalled(); expect(second.card).toHaveBeenCalledOnce();
    top = ids[0]; click();
    expect(first.card).toHaveBeenCalledOnce(); expect(second.card).toHaveBeenCalledOnce();
    a.destroy(); b.destroy();
  });

  it('puts plain pins and round markers in one ordered bitmap layer', async () => {
    const engine = stubEngine(), pixels = { width: 64, height: 64, data: new Uint8Array(64 * 64 * 4) };
    const buildPersonal = vi.fn(() => pixels), buildBadge = vi.fn(() => pixels);
    const layer = createAddedLayer(engine, { editable: true, buildPersonal, buildBadge });
    await layer.set({ type: 'FeatureCollection', features: ['badge-house', 'pin'].map((symbol, index) => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [2, 48] }, properties: { index, symbol, colour: '#0072b2' },
    })) });
    const features = [...engine.map.sources.values()][0].data.features;
    expect(features.every((feature) => feature.properties.$own)).toBe(true);
    expect(features[0].properties.$badge).toBe(true); expect(features[1].properties.$native).toBe(true);
    expect(buildPersonal).toHaveBeenCalledWith('pin', '#0072b2', { status: '', external: false });
    const own = [...engine.map.layers.values()].find((entry) => entry.id.endsWith('-own'));
    expect(own.layout['symbol-sort-key']).toEqual(['get', 'index']);
    expect(own.layout['icon-anchor']).toEqual(['case', ['has', '$native'], 'bottom', 'center']);
  });

  it('draws a status and an external rim into the marker image, one image per combination', async () => {
    const engine = stubEngine(), pixels = { width: 64, height: 64, data: new Uint8Array(64 * 64 * 4) };
    const buildPersonal = vi.fn(() => pixels), buildBadge = vi.fn(() => pixels);
    const layer = createAddedLayer(engine, { editable: true, buildPersonal, buildBadge });
    await layer.set({ type: 'FeatureCollection', features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [2, 48] },
        properties: { index: 0, symbol: 'badge-tank', colour: '#0072b2', status: 'destroyed', provenance: 'external' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [2, 48] },
        properties: { index: 1, symbol: 'badge-tank', colour: '#0072b2' } },
    ] });
    expect(buildBadge).toHaveBeenCalledWith('badge-tank', '#0072b2', { status: 'destroyed', external: true });
    const own = [...engine.map.sources.values()][0].data.features.map((feature) => feature.properties.$own);
    expect(own[0]).toMatch(/badge-tank-0072b2-destroyed-x$/);
    expect(own[1]).toMatch(/badge-tank-0072b2$/);
    expect(markerImageKey('pin', '#D55E00', { status: 'damaged' })).toBe('pin-d55e00-damaged');
  });

  it('turns a direction mark and writes names only for a personal layer', () => {
    const editable = stubEngine(), source = stubEngine();
    createAddedLayer(editable, { editable: true }).set({ type: 'FeatureCollection', features: [] });
    createAddedLayer(source).set({ type: 'FeatureCollection', features: [] });
    const bearing = [...editable.map.layers.values()].find((entry) => entry.id.endsWith('-bearing'));
    expect(bearing.layout['icon-rotate']).toEqual(['get', 'bearing']);
    expect(bearing.layout['icon-rotation-alignment']).toBe('map');
    const label = [...editable.map.layers.values()].find((entry) => entry.id.endsWith('-label'));
    expect(label.filter).toEqual(['all', ['!', ['any', ['has', '$trail'], ['has', '$change']]],
      ['has', 'show_label'], ['!=', ['get', 'name'], '']]);
    expect([...source.map.layers.keys()].some((id) => id.endsWith('-bearing') || id.endsWith('-label'))).toBe(false);
  });

  it('draws a feature\'s own look: a dash on any layer, a confidence, a hatch and arrowheads on the analyst\'s own', async () => {
    const engine = stubEngine();
    const line = (properties) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
      properties: { index: 0, category: 'Front', colour: '#d55e00', ...properties } });
    const source = createAddedLayer(engine);
    await source.set({ type: 'FeatureCollection', features: [line({ line_dash: 'dotted', confidence: 'claimed' })] });
    const sourceData = [...engine.map.sources.values()][0].data.features[0].properties;
    // a plate's dash reaches a source layer; a confidence is the analyst's own word
    expect(sourceData.$dash).toBe('dotted');
    const engine2 = stubEngine();
    const own = createAddedLayer(engine2, { editable: true, buildHatch: () => ({ width: 12, height: 12, data: new Uint8Array(12 * 12 * 4) }) });
    await own.set({ type: 'FeatureCollection', features: [line({ confidence: 'probable', line_arrow: 'both' }),
      { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, properties: { index: 1, category: 'Front', colour: '#0072b2', area_fill: 'hatch' } }] });
    const [main, heads] = [...engine2.map.sources.values()];
    expect(main.data.features[0].properties.$dash).toBe('dashed');
    expect(main.data.features[1].properties.$fillhatch).toMatch(/fillhatch-0072b2$/);
    expect(heads.data.features).toHaveLength(2);
    expect(heads.data.features.map((feature) => Math.round(feature.properties.$angle))).toEqual([45, 225]);
  });

  it('draws a tracked layer\'s past under it, dashed and hatched, and never on the layers that answer clicks', async () => {
    const engine = stubEngine();
    const buildHatch = vi.fn(() => ({ width: 12, height: 12, data: new Uint8Array(12 * 12 * 4) }));
    const layer = createAddedLayer(engine, { editable: true, history: true, buildHatch });
    const square = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
    await layer.set({ type: 'FeatureCollection', features: [
      { type: 'Feature', geometry: square, properties: { index: 0, category: 'Front', colour: '#d55e00', $change: 'gained' } },
      { type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: { index: 0, category: 'Front', colour: '#d55e00', $trail: true } },
    ] });
    expect(buildHatch).toHaveBeenCalledWith('#d55e00', 'gained');
    const [hatched] = [...engine.map.sources.values()][0].data.features;
    expect(hatched.properties.$hatch).toMatch(/hatch-gained-d55e00$/);
    const layers = [...engine.map.layers.values()];
    const ids = layers.map((entry) => entry.id);
    // the past is the lowest of the layer's own drawing
    expect(ids.findIndex((id) => id.endsWith('-change-fill'))).toBeLessThan(ids.findIndex((id) => id.endsWith('-fill') && !id.includes('change')));
    expect(layers.find((entry) => entry.id.endsWith('-trail-line')).paint['line-dasharray']).toEqual([2, 2]);
    expect(layers.find((entry) => entry.id.endsWith('-hit')).filter[1]).toEqual(['!', ['any', ['has', '$trail'], ['has', '$change']]]);
    // what is new keeps its own colour, whatever the feature's
    expect(layers.find((entry) => entry.id.endsWith('-new-line')).paint['line-color']).toBe('#ffd400');
    expect(layers.find((entry) => entry.id.endsWith('-new-ring')).filter).toContainEqual(['has', '$new']);
    expect(layers.find((entry) => entry.id.endsWith('-mark')).paint['icon-opacity']).toEqual(['case', ['has', '$fade'], 0.4, ['coalesce', ['get', '$opacity'], 0.95]]);
  });

  it('holds dragged features off the map until the move is drawn, keeping the other filters', async () => {
    const engine = stubEngine();
    const layer = createAddedLayer(engine, { editable: true });
    await layer.set({ type: 'FeatureCollection', features: [] }, { hidden: ['Old'] });
    const fill = () => JSON.stringify([...engine.map.layers.values()].find((entry) => entry.id.endsWith('-fill')).filter);
    layer.hide(['k1', 'k2']);
    expect(fill()).toContain('"k1","k2"');
    expect(fill()).toContain('"Old"');
    layer.hide([]);
    expect(fill()).not.toContain('"k1"');
    expect(fill()).toContain('"Old"');
  });

  it('lets held features back with the data that draws them where they landed, in the one filter', async () => {
    const engine = stubEngine();
    const layer = createAddedLayer(engine, { editable: true });
    await layer.set(COLLECTION, { hidden: ['Old'] });
    const fill = () => JSON.stringify([...engine.map.layers.values()].find((entry) => entry.id.endsWith('-fill')).filter);
    layer.hide(['k1']);
    const filters = [];
    const setFilter = engine.map.setFilter;
    engine.map.setFilter = (id, filter) => { if (id.endsWith('-fill')) filters.push(JSON.stringify(filter)); setFilter(id, filter); };
    await layer.set(COLLECTION, { hidden: ['Old'], held: [] });
    // one filter, written after the data: never one that shows them where they were
    expect(filters).toHaveLength(1);
    expect(fill()).not.toContain('"k1"');
    expect(fill()).toContain('"Old"');
    // and a set without it keeps what is held
    layer.hide(['k2']);
    await layer.set(COLLECTION, { hidden: ['Old'] });
    expect(fill()).toContain('"k2"');
  });

  it('says once the map has drawn what it was handed, and stops waiting after a while', async () => {
    vi.useFakeTimers();
    try {
      const engine = stubEngine();
      let loaded = false;
      Object.assign(engine.map, { isSourceLoaded: () => loaded, triggerRepaint: vi.fn() });
      const layer = createAddedLayer(engine, { editable: true });
      await layer.set(COLLECTION);
      const render = () => engine.map.handlers.filter(([type]) => type === 'render').forEach(([, run]) => run());
      let drawn = false;
      layer.drawn().then(() => { drawn = true; });
      expect(engine.map.triggerRepaint).toHaveBeenCalled();
      render(); await Promise.resolve();
      expect(drawn).toBe(false);
      loaded = true;
      render(); await Promise.resolve();
      expect(drawn).toBe(true);
      expect(engine.map.handlers.some(([type]) => type === 'render')).toBe(false);
      loaded = false;
      let late = false;
      layer.drawn(400).then(() => { late = true; });
      await vi.advanceTimersByTimeAsync(400);
      expect(late).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * Read off a stubbed map, because what this module has to get right is *which
 * MapLibre primitives a foreign layer becomes*: a GL source with style layers
 * rather than a DOM marker each, a filter rather than a second source, and an
 * icon registered at runtime rather than a sprite the engine would have to load.
 */

function stubMap() {
  const sources = new Map();
  const layers = new Map();
  const images = new Set();
  const handlers = [];
  return {
    sources,
    layers,
    images,
    handlers,
    addSource: (id, spec) => sources.set(id, { ...spec, data: spec.data }),
    getSource: (id) =>
      sources.has(id)
        ? { setData: (data) => sources.set(id, { ...sources.get(id), data }) }
        : undefined,
    removeSource: (id) => sources.delete(id),
    addLayer: (layer) => layers.set(layer.id, { ...layer }),
    getLayer: (id) => layers.get(id),
    removeLayer: (id) => layers.delete(id),
    // MapLibre's: the layer goes just under `before`, keeping everything else
    moveLayer: (id, before) => {
      const moved = layers.get(id);
      const rest = [...layers].filter(([key]) => key !== id);
      const at = rest.findIndex(([key]) => key === before);
      rest.splice(at < 0 ? rest.length : at, 0, [id, moved]);
      layers.clear();
      for (const [key, value] of rest) layers.set(key, value);
    },
    setFilter: (id, filter) => layers.set(id, { ...layers.get(id), filter }),
    setPaintProperty: (id, key, value) =>
      layers.set(id, { ...layers.get(id), paint: { ...layers.get(id).paint, [key]: value } }),
    setLayoutProperty: (id, key, value) =>
      layers.set(id, { ...layers.get(id), layout: { ...layers.get(id).layout, [key]: value } }),
    hasImage: (name) => images.has(name),
    addImage: (name) => images.add(name),
    getCanvas: () => ({ style: {} }),
    on: (type, on, handler) => handlers.push([type, on, handler]),
    off: (type, on, handler) => {
      const index = handlers.findIndex((entry) => entry[2] === handler);
      if (index >= 0) handlers.splice(index, 1);
    },
  };
}

function stubEngine() {
  const map = stubMap();
  return { impl: map, claimClicks: vi.fn(() => vi.fn()), fitBounds: vi.fn(), map };
}

/** The card, caught rather than drawn: what it was handed and where it was hung. */
function stubCard() {
  const popup = {
    setLngLat: (at) => ((popup.at = at), popup),
    setDOMContent: (node) => ((popup.body = node), popup),
    addTo: () => popup,
    on: () => popup,
    remove: () => ((popup.gone = true), popup),
  };
  const card = vi.fn((properties) => {
    const element = document.createElement('div');
    element.textContent = properties.name;
    return element;
  });
  return { card, popup, opts: { card, popup: (offset) => ((popup.offset = offset), popup) } };
}

const COLLECTION = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [2.35, 48.85] },
      properties: { name: 'North gate', category: 'Checkpoints', colour: '#ff0000', index: 0 },
    },
    {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[[2, 48], [2.1, 48], [2.1, 48.1], [2, 48]]] },
      properties: { name: 'Warehouse', category: 'Damage', colour: '', index: 1 },
    },
  ],
};

const CATEGORIES = [
  { name: 'Checkpoints', count: 1, colour: '#ff0000' },
  { name: 'Damage', count: 1, colour: '' },
];

/** The same layer, with the backend saying its point has a pictogram of its own. */
const DRESSED = {
  type: 'FeatureCollection',
  features: [
    {
      ...COLLECTION.features[0],
      properties: { ...COLLECTION.features[0].properties, icon: 'abc123' },
    },
    COLLECTION.features[1],
  ],
};

/** The first feature as the engine hands it back: rebuilt out of a tile, so its
 *  position is the tile grid's, a little off the file's. */
const ROUNDED_PIN = {
  ...COLLECTION.features[0],
  geometry: { type: 'Point', coordinates: [2.3507, 48.8503] },
};

/** Which symbol layer is which, told apart by the image each one draws. */
function symbolLayers(engine) {
  const symbols = [...engine.map.layers.values()].filter((layer) => layer.type === 'symbol');
  const drawing = (property) =>
    symbols.find((layer) => layer.layout['icon-image']?.[1] === property);
  return { own: drawing('$own'), fallback: drawing('$icon') };
}

describe('the translation to MapLibre', () => {
  it('puts a category colour in one expression rather than into every feature', () => {
    // the legend row and the marks then read the same value from the same place
    expect(colourExpression(CATEGORIES)).toEqual([
      'match',
      ['get', 'category'],
      'Checkpoints',
      '#ff0000',
      'Damage',
      PALETTE[1],
      PALETTE[0],
    ]);
  });

  it('turns hidden categories into a filter and nothing into no filter at all', () => {
    expect(visibilityFilter([])).toBeNull();
    expect(visibilityFilter(['Damage'])).toEqual([
      '!',
      ['in', ['get', 'category'], ['literal', ['Damage']]],
    ]);
  });

  it('knows three shapes and nothing finer, as the backend does', () => {
    expect(kindOf({ type: 'MultiPoint' })).toBe('point');
    expect(kindOf({ type: 'LineString' })).toBe('line');
    expect(kindOf({ type: 'MultiPolygon' })).toBe('area');
  });
});

describe('the icons', () => {
  it('registers one image per shape, as an SDF so a colour can tint it', () => {
    const map = stubMap();
    const added = [];
    map.addImage = (name, image, options) => {
      map.images.add(name);
      added.push([name, options]);
    };

    registerIcons(map, () => ({ width: 1, height: 1, data: new Uint8ClampedArray(4) }));

    expect(added.map(([name]) => name)).toEqual([
      iconName('point'),
      iconName('line'),
      iconName('area'),
    ]);
    // without `sdf`, honouring a source's colour would mean one registered
    // image per (shape × colour) pair
    expect(added.every(([, options]) => options.sdf)).toBe(true);
  });

  it('registers each image once, however many layers ask for it', () => {
    const map = stubMap();
    const build = vi.fn(() => ({ width: 1, height: 1, data: new Uint8ClampedArray(4) }));

    registerIcons(map, build);
    registerIcons(map, build);

    expect(build).toHaveBeenCalledTimes(3);
  });
});

/**
 * The source's own pictograms, which the backend already composed into PNGs.
 *
 * What this side has to get right is the routing and the fallback: a point whose
 * icon arrived draws it out of a non-SDF layer, a point whose icon did not draws
 * the app's tinted shape, and neither decision can be made before the image is
 * registered — a symbol asking for an image the map does not hold draws nothing.
 */
describe("a source's own icons", () => {
  const source = (url = '/icons') => ({
    iconUrl: (key) => `${url}/${key}`,
    loadIcon: vi.fn(async () => ({ width: 8, height: 8, data: new Uint8ClampedArray(256) })),
  });

  it('asks this server for the icon, by the key the feature carries', async () => {
    const engine = stubEngine();
    const opts = source('/api/cases/c1/map-layers/roads/icons');

    await createAddedLayer(engine, opts).set(DRESSED, { categories: CATEGORIES });

    expect(opts.loadIcon).toHaveBeenCalledTimes(1);
    expect(opts.loadIcon.mock.calls[0][1]).toBe(
      '/api/cases/c1/map-layers/roads/icons/abc123'
    );
  });

  it('registers it without the SDF flag, because the colour is already in it', async () => {
    const engine = stubEngine();
    const added = [];
    engine.map.addImage = (name, image, options) => {
      engine.map.images.add(name);
      added.push([name, options]);
    };

    await createAddedLayer(engine, source()).set(DRESSED, { categories: CATEGORIES });

    const [, options] = added.find(([name]) => name.includes('abc123'));
    expect(options).toBeUndefined();
  });

  it('routes the point to the layer that draws pictures, not the tinted one', async () => {
    const engine = stubEngine();

    await createAddedLayer(engine, source()).set(DRESSED, { categories: CATEGORIES });

    const [stored] = [...engine.map.sources.values()];
    const [point] = stored.data.features;
    expect(point.properties.$own).toBe('azimut-source-/icons/abc123');
    const { own } = symbolLayers(engine);
    expect(own.layout['icon-anchor']).toBe('center');
  });

  it('leaves a point whose icon never arrived on the app pictogram', async () => {
    const engine = stubEngine();
    const opts = { iconUrl: (key) => `/icons/${key}`, loadIcon: vi.fn(async () => null) };

    await createAddedLayer(engine, opts).set(DRESSED, { categories: CATEGORIES });

    const [stored] = [...engine.map.sources.values()];
    expect(stored.data.features[0].properties.$own).toBeUndefined();
    expect(stored.data.features[0].properties.$icon).toBe(iconName('point'));
  });

  it('survives an icon that throws, which is what a 404 arrives as', async () => {
    const engine = stubEngine();
    const opts = {
      iconUrl: (key) => `/icons/${key}`,
      loadIcon: vi.fn(async () => {
        throw new Error('404');
      }),
    };

    await createAddedLayer(engine, opts).set(DRESSED, { categories: CATEGORIES });

    const [stored] = [...engine.map.sources.values()];
    expect(stored.data.features).toHaveLength(2);
    expect(stored.data.features[0].properties.$own).toBeUndefined();
  });

  it('asks for nothing at all when the layer stored no icons', async () => {
    const engine = stubEngine();
    const loadIcon = vi.fn();

    await createAddedLayer(engine, { loadIcon }).set(DRESSED, { categories: CATEGORIES });

    expect(loadIcon).not.toHaveBeenCalled();
    const [stored] = [...engine.map.sources.values()];
    expect(stored.data.features[0].properties.$own).toBeUndefined();
  });

  it('fetches one icon once, however many features wear it', async () => {
    const engine = stubEngine();
    const opts = source();
    const crowd = {
      type: 'FeatureCollection',
      features: [0, 1, 2, 3].map((index) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [index, 48] },
        properties: { category: 'Checkpoints', colour: '', icon: 'abc123', index },
      })),
    };

    await createAddedLayer(engine, opts).set(crowd, { categories: CATEGORIES });

    expect(opts.loadIcon).toHaveBeenCalledTimes(1);
  });

  it('keeps the two symbol layers apart under a category filter', async () => {
    const engine = stubEngine();
    const layer = createAddedLayer(engine, source());
    await layer.set(DRESSED, { categories: CATEGORIES });

    layer.filter(['Damage']);

    const { own, fallback } = symbolLayers(engine);
    expect(JSON.stringify(own.filter)).toContain('"$own"');
    expect(JSON.stringify(fallback.filter)).toContain('"!"');
    // and both still drop the hidden group
    expect(JSON.stringify(own.filter)).toContain('Damage');
    expect(JSON.stringify(fallback.filter)).toContain('Damage');
  });

  it('keeps one layer\'s picture off another\'s markers that share its key', async () => {
    // two My Maps both say `images/icon-3.png`, so the backend gives two pictures one key
    const engine = stubEngine();
    const yemen = source('/api/cases/c1/map-layers/yemen/icons');
    const venezuela = source('/api/cases/c2/map-layers/venezuela/icons');

    await createAddedLayer(engine, yemen).set(DRESSED, { categories: CATEGORIES });
    await createAddedLayer(engine, venezuela).set(DRESSED, { categories: CATEGORIES });

    expect(venezuela.loadIcon.mock.calls[0][1]).toBe('/api/cases/c2/map-layers/venezuela/icons/abc123');
    const [first, second] = [...engine.map.sources.values()].map((stored) => stored.data.features[0].properties.$own);
    expect(first).not.toBe(second);
    expect(engine.map.hasImage(second)).toBe(true);
  });

  it('reads the new picture of a layer refreshed in place, under the key it had', async () => {
    // a My Maps renumbers its images/icon-N.png, so a refresh can redraw a key
    const engine = stubEngine();
    let version = 'one';
    const opts = { iconUrl: (key) => `/icons/${key}?v=${version}`,
      loadIcon: vi.fn(async () => ({ width: 8, height: 8, data: new Uint8ClampedArray(256) })) };
    const layer = createAddedLayer(engine, opts);
    await layer.set(DRESSED, { categories: CATEGORIES });
    const before = [...engine.map.sources.values()][0].data.features[0].properties.$own;

    version = 'two';
    await layer.set(DRESSED, { categories: CATEGORIES });

    expect(opts.loadIcon.mock.calls.map(([, url]) => url)).toEqual(['/icons/abc123?v=one', '/icons/abc123?v=two']);
    const after = [...engine.map.sources.values()][0].data.features[0].properties.$own;
    expect(after).not.toBe(before);
    expect(engine.map.hasImage(after)).toBe(true);
  });

  it('lands nowhere when the layer was torn down while its icons loaded', async () => {
    const engine = stubEngine();
    let release;
    const layer = createAddedLayer(engine, {
      iconUrl: (key) => `/icons/${key}`,
      loadIcon: () => new Promise((resolve) => (release = resolve)),
    });

    const pending = layer.set(DRESSED, { categories: CATEGORIES });
    layer.destroy();
    release({ width: 8, height: 8, data: new Uint8ClampedArray(256) });
    await pending;

    expect(engine.map.sources.size).toBe(0);
  });
});

describe('an added layer on the map', () => {
  it('is one GeoJSON source with style layers, not a marker per feature', async () => {
    const engine = stubEngine();
    await createAddedLayer(engine).set(COLLECTION, { categories: CATEGORIES });

    expect(engine.map.sources.size).toBe(1);
    // Two symbol layers, because a source's own icons are plain PNGs and ours
    // are SDFs, and MapLibre does not render both out of one; three line layers,
    // because a dash cannot be read off a feature (solid, dashed, dotted).
    expect([...engine.map.layers.values()].map((layer) => layer.type).sort()).toEqual([
      'circle',
      'fill',
      'line',
      'line',
      'line',
      'symbol',
      'symbol',
    ]);
  });

  it('loads every feature and lets the engine cull, rather than truncating', async () => {
    const engine = stubEngine();
    await createAddedLayer(engine).set(COLLECTION, { categories: CATEGORIES });

    const [source] = [...engine.map.sources.values()];
    expect(source.data.features).toHaveLength(COLLECTION.features.length);
  });

  it('hands the engine the same features once: a layer read back after its own save is not cut again', async () => {
    const engine = stubEngine();
    engine.map.triggerRepaint = vi.fn();
    const layer = createAddedLayer(engine, { editable: true });
    await layer.set(COLLECTION, { categories: CATEGORIES });
    const [main, arrows] = [...engine.map.sources.values()];
    const first = main.data;
    const empty = arrows.data;
    // new objects, the same features: nothing handed again, a frame asked for whoever waits on one
    await layer.set(structuredClone(COLLECTION), { categories: CATEGORIES });
    const [mainAfter, arrowsAfter] = [...engine.map.sources.values()];
    expect(mainAfter.data).toBe(first);
    expect(arrowsAfter.data).toBe(empty);
    expect(engine.map.triggerRepaint).toHaveBeenCalledTimes(1);
    // one feature moved: the whole layer is handed again, in its order
    const moved = structuredClone(COLLECTION);
    moved.features[0].geometry.coordinates = [9, 9];
    await layer.set(moved, { categories: CATEGORIES });
    const handed = [...engine.map.sources.values()][0].data;
    expect(handed).not.toBe(first);
    expect(handed.features.map((f) => f.properties.name)).toEqual(COLLECTION.features.map((f) => f.properties.name));
    expect(handed.features[0].geometry.coordinates).toEqual([9, 9]);
    // the same features in other groups are drawn again in their new colours
    await layer.set(moved, { categories: [...CATEGORIES].reverse() });
    expect([...engine.map.sources.values()][0].data).not.toBe(handed);
    // the arrow heads' source was never emptied again, having nothing in it
    expect([...engine.map.sources.values()][1].data).toBe(empty);
  });

  it('declutters by collision rather than by a cap taken in file order', async () => {
    // a KML is ordered by folder or by creation, never by geography, so a cap
    // would clump; MapLibre dropping an overlapping symbol spreads evenly
    const engine = stubEngine();
    await createAddedLayer(engine).set(COLLECTION, { categories: CATEGORIES });

    const marks = [...engine.map.layers.values()].find((layer) => layer.type === 'symbol');
    expect(marks.layout['icon-allow-overlap']).toBe(false);
    expect(marks.layout['symbol-sort-key']).toEqual(['get', 'index']);
  });

  it('draws no text: a feature’s name is read in the hover and the card', async () => {
    const engine = stubEngine();
    await createAddedLayer(engine).set(COLLECTION, { categories: CATEGORIES });

    for (const layer of engine.map.layers.values()) {
      expect(layer.layout?.['text-field']).toBeUndefined();
    }
  });

  it('carries the source its credit line, as a curated overlay does', async () => {
    const engine = stubEngine();
    await createAddedLayer(engine).set(COLLECTION, {
      categories: CATEGORIES,
      attribution: 'Sightings — Google My Maps',
    });

    const [source] = [...engine.map.sources.values()];
    expect(source.attribution).toBe('Sightings — Google My Maps');
  });

  it('hides exactly the category named, and keeps the features loaded', async () => {
    const engine = stubEngine();
    const layer = createAddedLayer(engine);
    await layer.set(COLLECTION, { categories: CATEGORIES });

    layer.filter(['Damage']);

    for (const drawn of engine.map.layers.values()) {
      expect(JSON.stringify(drawn.filter)).toContain('Damage');
    }
    const [source] = [...engine.map.sources.values()];
    expect(source.data.features).toHaveLength(2);
  });

  it('keeps to a period by comparing days, and leaves the undated out of it', async () => {
    expect(periodFilter(null)).toBeNull();
    expect(periodFilter({ start: '', end: '' })).toBeNull();
    // a span is kept while its last day is still in the period
    expect(periodFilter({ start: '2026-09-01', end: '' })).toEqual([
      'all',
      ['has', 'date'],
      ['>=', ['coalesce', ['get', 'date_end'], ['get', 'date']], '2026-09-01'],
    ]);

    const engine = stubEngine();
    const layer = createAddedLayer(engine);
    await layer.set(COLLECTION, { categories: CATEGORIES });
    layer.filter(['Damage'], { start: '2026-09-01', end: '2026-09-18' });

    for (const drawn of engine.map.layers.values()) {
      const rule = JSON.stringify(drawn.filter);
      expect(rule).toContain('Damage');
      expect(rule).toContain('2026-09-18');
    }
  });

  it('applies the same filter once, however often a dragged strip asks', async () => {
    // a card opened on the map closes on every new filter, so an unchanged one
    // must not count as new
    const engine = stubEngine();
    const layer = createAddedLayer(engine);
    await layer.set(COLLECTION, { categories: CATEGORIES });
    const setFilter = vi.spyOn(engine.map, 'setFilter');

    layer.filter([], { start: '2026-09-01', end: '' });
    const once = setFilter.mock.calls.length;
    layer.filter([], { start: '2026-09-01', end: '' });

    expect(once).toBeGreaterThan(0);
    expect(setFilter.mock.calls.length).toBe(once);
  });

  it('puts the filter back when the category is switched on again', async () => {
    const engine = stubEngine();
    const layer = createAddedLayer(engine);
    await layer.set(COLLECTION, { categories: CATEGORIES });
    layer.filter(['Damage']);

    layer.filter([]);

    for (const drawn of engine.map.layers.values()) {
      expect(JSON.stringify(drawn.filter)).not.toContain('Damage');
    }
  });

  it('keeps the features and takes them off the map when switched off', async () => {
    const engine = stubEngine();
    const layer = createAddedLayer(engine);
    await layer.set(COLLECTION, { categories: CATEGORIES });

    layer.visible(false);

    for (const drawn of engine.map.layers.values()) {
      expect(drawn.layout.visibility).toBe('none');
    }
    expect(engine.map.sources.size).toBe(1);
  });

  it('restacks under another added layer as one block, in its own order', async () => {
    const engine = stubEngine();
    const lower = createAddedLayer(engine);
    const upper = createAddedLayer(engine);
    await lower.set(COLLECTION, { categories: CATEGORIES });
    await upper.set(COLLECTION, { categories: CATEGORIES });

    // built last, so on top: now asked under the one built first
    upper.stackUnder(lower);

    const ids = [...engine.map.layers.keys()];
    const own = (layer) => ids.filter((id) => id.startsWith(layer.floor().replace(/-fill$/, '-')));
    expect(ids).toEqual([...own(upper), ...own(lower)]);
    expect(own(upper).map((id) => id.split('-').pop())).toEqual(['fill', 'line', 'dash', 'dot', 'dot', 'mark', 'own']);
  });

  it('moves nothing while either layer is still unbuilt', async () => {
    const engine = stubEngine();
    const built = createAddedLayer(engine);
    const waiting = createAddedLayer(engine);
    await built.set(COLLECTION, { categories: CATEGORIES });
    const before = [...engine.map.layers.keys()];

    expect(waiting.floor()).toBeNull();
    built.stackUnder(waiting);
    waiting.stackUnder(built);

    expect([...engine.map.layers.keys()]).toEqual(before);
  });

  it('drops its source and its layers when it is removed', async () => {
    const engine = stubEngine();
    const layer = createAddedLayer(engine);
    await layer.set(COLLECTION, { categories: CATEGORIES });

    layer.destroy();

    expect(engine.map.sources.size).toBe(0);
    expect(engine.map.layers.size).toBe(0);
    expect(engine.map.handlers).toHaveLength(0);
  });

  it('opens a read-only card and offers no way into the case from it', async () => {
    const engine = stubEngine();
    const card = vi.fn((properties) => {
      const element = document.createElement('div');
      element.textContent = properties.name;
      return element;
    });
    const popup = {
      setLngLat: () => popup,
      setDOMContent: (node) => ((popup.body = node), popup),
      addTo: () => popup,
      on: () => popup,
      remove: () => popup,
    };
    await createAddedLayer(engine, { card, popup: () => popup }).set(COLLECTION, {
      categories: CATEGORIES,
    });

    const [, , click] = engine.map.handlers.find(([type]) => type === 'click');
    click({ lngLat: [2.35, 48.85], features: [COLLECTION.features[0]] });

    expect(card).toHaveBeenCalledWith(COLLECTION.features[0].properties, { lat: 48.85, lon: 2.35 }, COLLECTION.features[0].geometry);
    // nothing to confirm, nothing to save, no path out of it into the case
    expect(popup.body.querySelectorAll('button, a, input, form')).toHaveLength(0);
  });

  it('pins the card to the point, not to the spot on the pin that was clicked', async () => {
    // A pin is clicked on its head, twenty-odd pixels above the ground it claims
    // — and that gap, taken as a lngLat, is the same *ground* distance at every
    // zoom. Anchored on the click, the card slides off its own mark as the map
    // is zoomed in, which is the bug this is here to keep fixed.
    const engine = stubEngine();
    const { popup, opts } = stubCard();
    await createAddedLayer(engine, opts).set(COLLECTION, { categories: CATEGORIES });
    const [, , click] = engine.map.handlers.find(([type]) => type === 'click');

    click({ lngLat: [2.3502, 48.8504], features: [COLLECTION.features[0]] });

    expect(popup.at).toEqual([2.35, 48.85]);
    // and hung off it by the pin's own drawn height, or it opens over the mark
    expect(popup.offset).toBe(22);

    // an area has no one point, so it is read where it was touched
    click({ lngLat: [2.05, 48.05], features: [COLLECTION.features[1]] });

    expect(popup.at).toEqual([2.05, 48.05]);
    expect(popup.offset).toBeLessThan(22);
  });

  it("hands the card the pin's point as the file wrote it, not as a tile rounded it", async () => {
    // A rendered feature is rebuilt out of a tile, its position snapped to the
    // tile's grid: far out that is tens of metres, and it is what gets copied.
    const engine = stubEngine();
    const { card, popup, opts } = stubCard();
    await createAddedLayer(engine, opts).set(COLLECTION, { categories: CATEGORIES });
    const [, , click] = engine.map.handlers.find(([type]) => type === 'click');

    click({ lngLat: [2.3511, 48.8511], features: [ROUNDED_PIN] });

    expect(card).toHaveBeenCalledWith(ROUNDED_PIN.properties, { lat: 48.85, lon: 2.35 }, COLLECTION.features[0].geometry);
    expect(popup.at).toEqual([2.35, 48.85]);
  });

  it('hands the card the whole area to measure, not the piece a tile clipped', async () => {
    const engine = stubEngine();
    const { card, opts } = stubCard();
    await createAddedLayer(engine, opts).set(COLLECTION, { categories: CATEGORIES });
    const [, , click] = engine.map.handlers.find(([type]) => type === 'click');
    const clipped = { ...COLLECTION.features[1], geometry: { type: 'Polygon', coordinates: [[[2, 48], [2.05, 48], [2.05, 48.05], [2, 48]]] } };

    click({ lngLat: [2.03, 48.01], features: [clipped] });

    expect(card).toHaveBeenCalledWith(COLLECTION.features[1].properties, null, COLLECTION.features[1].geometry);
  });
});

/**
 * The right-click, which the features claim along with their clicks.
 *
 * Claimed and answered by nobody, it opened nothing at all: not on a pin, not
 * anywhere inside an area. It opens the map's own point menu instead, on the
 * pin's point, since the pin's head is clicked some twenty pixels above it.
 */
describe('a right-click on an added layer', () => {
  /** The right-click the engine would deliver, and what the layer made of it. */
  async function rightClick(event, { menu = vi.fn() } = {}) {
    const engine = stubEngine();
    const { opts } = stubCard();
    await createAddedLayer(engine, { ...opts, menu }).set(COLLECTION, { categories: CATEGORIES });
    const handler = engine.map.handlers.find(([type]) => type === 'contextmenu');
    handler?.[2](event);
    return { menu, engine, handler };
  }

  it("opens the point menu on the pin's own point, not the ground under its head", async () => {
    const { menu } = await rightClick({
      lngLat: { lat: 48.8511, lng: 2.3511 },
      point: { x: 140, y: 90 },
      features: [ROUNDED_PIN],
    });

    expect(menu).toHaveBeenCalledWith(
      { lat: 48.85, lon: 2.35, x: 140, y: 90 },
      COLLECTION.features[0].properties
    );
  });

  it('opens it where it was pressed inside an area, which has no one point', async () => {
    // a world copy away, as the map counts past the antimeridian
    const { menu } = await rightClick({
      lngLat: { lat: 48.05, lng: 362.05 },
      point: { x: 300, y: 200 },
      features: [COLLECTION.features[1]],
    });

    const [at, named] = menu.mock.calls[0];
    expect(at.lat).toBe(48.05);
    expect(at.lon).toBeCloseTo(2.05, 9);
    expect([at.x, at.y]).toEqual([300, 200]);
    // nothing to name: the menu is on the ground, not on a feature's point
    expect(named).toBeNull();
  });

  it('takes the pin over the area it stands in', async () => {
    const { menu } = await rightClick({
      lngLat: { lat: 48.05, lng: 2.05 },
      point: { x: 10, y: 10 },
      features: [COLLECTION.features[1], COLLECTION.features[0]],
    });

    expect(menu.mock.calls[0][0]).toMatchObject({ lat: 48.85, lon: 2.35 });
  });

  it('is claimed from the map, so the ground menu does not open a second time behind it', async () => {
    const { engine } = await rightClick({ lngLat: { lat: 0, lng: 0 }, point: { x: 0, y: 0 }, features: [] });
    expect(engine.claimClicks).toHaveBeenCalled();
  });

  it("lets the map's own tool have the clicks while it holds the pointer", async () => {
    // a measure, a pin or an area being drawn over a layer: the click is the tool's
    const release = vi.fn();
    const engine = stubEngine();
    engine.claimClicks = vi.fn(() => release);
    const card = vi.fn(() => document.createElement('div'));
    const menu = vi.fn();
    const { opts } = stubCard();
    const layer = createAddedLayer(engine, { ...opts, card, menu });
    await layer.set(COLLECTION, { categories: CATEGORIES });
    expect(engine.claimClicks).toHaveBeenCalledTimes(1);

    layer.interactive(false);
    expect(release).toHaveBeenCalled();
    const handler = (type) => engine.map.handlers.find(([kind]) => kind === type)[2];
    handler('click')({ lngLat: [2.35, 48.85], features: [COLLECTION.features[0]] });
    handler('contextmenu')({ lngLat: { lat: 48.85, lng: 2.35 }, point: { x: 1, y: 1 }, features: [COLLECTION.features[0]] });
    expect(card).not.toHaveBeenCalled();
    expect(menu).not.toHaveBeenCalled();

    // the tool put down, the layer answers again
    layer.interactive(true);
    expect(engine.claimClicks).toHaveBeenCalledTimes(2);
    handler('click')({ lngLat: [2.35, 48.85], features: [COLLECTION.features[0]] });
    expect(card).toHaveBeenCalled();
  });

  it('opens nothing when nobody asked for a menu, and does not throw', async () => {
    const engine = stubEngine();
    const { opts } = stubCard();
    await createAddedLayer(engine, opts).set(COLLECTION, { categories: CATEGORIES });
    const [, , handler] = engine.map.handlers.find(([type]) => type === 'contextmenu');

    expect(() =>
      handler({ lngLat: { lat: 48.85, lng: 2.35 }, point: { x: 1, y: 1 }, features: [COLLECTION.features[0]] })
    ).not.toThrow();
  });
});

/**
 * Going to one feature, which is what picking a search result does.
 *
 * The rule under all of it: finding a feature ends where clicking one ends — at
 * the read-only card. There is no second, richer thing a search can open.
 */
describe('going to one feature', () => {
  it('boxes a point, a line and an area by one rule', () => {
    // a point has no extent, so the box collapses and the zoom ceiling decides
    expect(featureExtent({ type: 'Point', coordinates: [2.35, 48.85] })).toEqual({
      west: 2.35,
      east: 2.35,
      south: 48.85,
      north: 48.85,
    });
    expect(
      featureExtent({ type: 'LineString', coordinates: [[2, 48], [3, 49], [2.5, 47]] })
    ).toEqual({ west: 2, east: 3, south: 47, north: 49 });
    expect(featureExtent(COLLECTION.features[1].geometry)).toEqual({
      west: 2,
      east: 2.1,
      south: 48,
      north: 48.1,
    });
  });

  it('reaches into a MultiPolygon and a GeometryCollection alike', () => {
    expect(
      featureExtent({
        type: 'GeometryCollection',
        geometries: [
          { type: 'Point', coordinates: [1, 1] },
          { type: 'MultiPolygon', coordinates: [[[[5, 5], [6, 5], [6, 6], [5, 5]]]] },
        ],
      })
    ).toEqual({ west: 1, east: 6, south: 1, north: 6 });
  });

  it('has no box for a geometry with no positions in it', () => {
    expect(featureExtent({ type: 'Polygon', coordinates: [] })).toBe(null);
    expect(featureExtent(null)).toBe(null);
  });

  it('finds a feature by the number the backend gave it, not by luck', () => {
    // the number is the position, so the hit is direct…
    expect(featureAt(COLLECTION, 1)).toBe(COLLECTION.features[1]);
    // …and a collection that arrived in another order still answers correctly,
    // because a card opened on the wrong feature is the failure to refuse
    const shuffled = { features: [...COLLECTION.features].reverse() };
    expect(featureAt(shuffled, 0)).toBe(COLLECTION.features[0]);
    expect(featureAt(COLLECTION, 7)).toBe(null);
  });

  it('frames the feature and opens the same card a click opens', async () => {
    const engine = stubEngine();
    const { card, popup, opts } = stubCard();
    const layer = createAddedLayer(engine, opts);
    await layer.set(COLLECTION, { categories: CATEGORIES });

    expect(layer.reveal(1)).toBe(true);

    expect(engine.fitBounds).toHaveBeenCalledWith(
      { west: 2, east: 2.1, south: 48, north: 48.1 },
      expect.objectContaining({ maxZoom: 17, animate: true })
    );
    // an area has no one point to state
    expect(card).toHaveBeenCalledWith(COLLECTION.features[1].properties, null, COLLECTION.features[1].geometry);
    // nothing to confirm, nothing to save: a found feature is not an adopted one
    expect(popup.body.querySelectorAll('button, a, input, form')).toHaveLength(0);
  });

  it('hangs the card off the pin itself when the feature is a point', async () => {
    const engine = stubEngine();
    const { popup, opts } = stubCard();
    const layer = createAddedLayer(engine, opts);
    await layer.set(COLLECTION, { categories: CATEGORIES });

    layer.reveal(0);

    expect(popup.at).toEqual([2.35, 48.85]);
  });

  it('goes nowhere at all for a number that names no feature', async () => {
    const engine = stubEngine();
    const { card, opts } = stubCard();
    const layer = createAddedLayer(engine, opts);
    await layer.set(COLLECTION, { categories: CATEGORIES });

    expect(layer.reveal(9)).toBe(false);

    expect(engine.fitBounds).not.toHaveBeenCalled();
    expect(card).not.toHaveBeenCalled();
  });

  it('has nothing to go to before the features have landed', () => {
    const engine = stubEngine();

    expect(createAddedLayer(engine, stubCard().opts).reveal(0)).toBe(false);
    expect(engine.fitBounds).not.toHaveBeenCalled();
  });
});

/**
 * One of the analyst's own icons on a personal layer: drawn as the source's
 * pictograms are when it is a plain picture, composed when it is worn in a disc
 * or carries a status stroke, and always over the symbol kept as its fallback.
 */
describe("the analyst's own icons on a personal layer", () => {
  const picture = { image: { width: 64, height: 64 }, box: { x: 0, y: 0, w: 64, h: 64 } };
  const pixels = { width: 64, height: 64, data: new Uint8Array(64 * 64 * 4) };
  const dressed = (properties) => ({ type: 'FeatureCollection', features: [{ type: 'Feature',
    geometry: { type: 'Point', coordinates: [2, 48] },
    properties: { index: 0, category: 'Mine', colour: '#d55e00', symbol: 'badge-tank', icon: 'abcdef0123456789', ...properties } }] });
  const opts = (extra = {}) => ({ editable: true, iconUrl: (key) => `/icons/${key}`,
    loadIcon: vi.fn(async () => ({ width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4) })),
    readPicture: vi.fn(async () => picture), buildOwn: vi.fn(() => pixels), buildBadge: vi.fn(() => pixels), ...extra });
  const drawn = (engine) => [...engine.map.sources.values()][0].data.features[0].properties;

  it('wears the icon over the symbol it keeps as a fallback, as a plain picture when nothing is added to it', async () => {
    const engine = stubEngine(), options = opts();
    await createAddedLayer(engine, options).set(dressed({ icon_mode: 'image' }));
    expect(options.buildBadge).not.toHaveBeenCalled();
    expect(options.buildOwn).not.toHaveBeenCalled();
    expect(drawn(engine).$own).toBe('azimut-source-/icons/abcdef0123456789');
  });

  it('composes it into a disc of the marker colour', async () => {
    const engine = stubEngine(), options = opts();
    await createAddedLayer(engine, options).set(dressed({ icon_mode: 'disc' }));
    expect(options.readPicture).toHaveBeenCalledWith('/icons/abcdef0123456789');
    expect(options.buildOwn).toHaveBeenCalledWith(picture, '#d55e00', { mode: 'disc', status: '', external: false });
    expect(drawn(engine).$badge).toBe(true);
    expect(drawn(engine).$own).toContain('own-abcdef0123456789-disc');
  });

  it('composes a picture drawn as it is when it carries a status or an external rim', async () => {
    const engine = stubEngine(), options = opts();
    await createAddedLayer(engine, options).set(dressed({ icon_mode: 'image', status: 'destroyed', provenance: 'external' }));
    expect(options.buildOwn).toHaveBeenCalledWith(picture, '#d55e00', { mode: 'image', status: 'destroyed', external: true });
    expect(drawn(engine).$own).toContain('-destroyed-x');
  });

  it('falls back to its symbol when the picture cannot be read', async () => {
    const engine = stubEngine(), options = opts({ loadIcon: vi.fn(async () => null), readPicture: vi.fn(async () => null) });
    await createAddedLayer(engine, options).set(dressed({ icon_mode: 'disc' }));
    expect(options.buildOwn).not.toHaveBeenCalled();
    expect(options.buildBadge).toHaveBeenCalledWith('badge-tank', '#d55e00', { status: '', external: false });
  });
});
