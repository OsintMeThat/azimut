// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import {
  colourExpression,
  createAddedLayer,
  featureAt,
  featureExtent,
  iconName,
  kindOf,
  periodFilter,
  registerIcons,
  visibilityFilter,
} from './addedLayer.js';
import { PALETTE } from './addedLayers.js';

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
    expect(point.properties.$own).toBe('azimut-source-abc123');
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
    // are SDFs, and MapLibre does not render both out of one.
    expect([...engine.map.layers.values()].map((layer) => layer.type).sort()).toEqual([
      'circle',
      'fill',
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

  it('declutters by collision rather than by a cap taken in file order', async () => {
    // a KML is ordered by folder or by creation, never by geography, so a cap
    // would clump; MapLibre dropping an overlapping symbol spreads evenly
    const engine = stubEngine();
    await createAddedLayer(engine).set(COLLECTION, { categories: CATEGORIES });

    const marks = [...engine.map.layers.values()].find((layer) => layer.type === 'symbol');
    expect(marks.layout['icon-allow-overlap']).toBe(false);
    expect(marks.layout['symbol-sort-key']).toEqual(['get', 'index']);
  });

  it('draws no text, because the engine loads no glyphs and will not start', async () => {
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

    expect(card).toHaveBeenCalledWith(COLLECTION.features[0].properties, { lat: 48.85, lon: 2.35 });
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

    expect(card).toHaveBeenCalledWith(ROUNDED_PIN.properties, { lat: 48.85, lon: 2.35 });
    expect(popup.at).toEqual([2.35, 48.85]);
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
    expect(card).toHaveBeenCalledWith(COLLECTION.features[1].properties, null);
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
