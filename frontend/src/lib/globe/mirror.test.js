// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { boundsOf, changedBounds, createMirror, featuresOf } from './mirror.js';

const line = (coordinates, properties = {}) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates }, properties });

/** The flat map as far as the mirror reads it: layers, GeoJSON sources, events, and the calls it answers in its place. */
function stubMap() {
  const layers = new Map();
  const sources = new Map();
  const handlers = new Map();
  const fired = [];
  const canvas = document.createElement('canvas');
  const handler = () => {
    let on = true;
    return { isEnabled: () => on, disable: () => (on = false), enable: () => (on = true) };
  };
  const map = {
    layers,
    sources,
    fired,
    addLayer(spec) {
      layers.set(spec.id, spec);
    },
    getLayersOrder: () => [...layers.keys()],
    getLayer: (id) => (layers.has(id) ? { serialize: () => layers.get(id) } : undefined),
    getSource: (id) => sources.get(id),
    on: (name, fn) => handlers.set(name, [...(handlers.get(name) ?? []), fn]),
    off: (name, fn) => handlers.set(name, (handlers.get(name) ?? []).filter((h) => h !== fn)),
    emit: (name, event) => (handlers.get(name) ?? []).forEach((fn) => fn(event)),
    fire: (event) => fired.push(typeof event === 'string' ? event : event.type),
    getImage: () => null,
    getCanvas: () => canvas,
    dragPan: handler(),
    scrollZoom: handler(),
  };
  map.project = function project() {
    return 'flat';
  };
  return map;
}

/** The globe as far as the mirror asks it: a view of 800 × 600 where a point stands at its degrees ×10. */
function stubGlobe() {
  const listeners = new Map();
  return {
    invalidated: [],
    laid: null,
    invalidate(bounds) {
      this.invalidated.push(bounds ?? 'everywhere');
    },
    redraw: vi.fn(),
    setLaid(laid) {
      this.laid = laid;
    },
    on(name, fn) {
      listeners.set(name, fn);
      return () => listeners.delete(name);
    },
    emit: (name, payload) => listeners.get(name)?.(payload),
    drawnTiles: () => [],
    size: () => ({ width: 800, height: 600 }),
    standingAt: (lat, lon) => ({ x: lon * 10, y: lat * 10, distance: 1000 }),
    zoomAt: () => 10,
    heading: () => 30,
    camera: () => ({ lat: 1, lon: 2, zoom: 11, bearing: 0, pitch: 40 }),
    containerPointToLatLng: ({ x, y }) => ({ lat: y / 10, lon: x / 10 }),
    getZoom: () => 11,
    metresPerPixelAt: () => 1,
    setCursor: vi.fn(),
  };
}

/** A canvas whose 2D context records strokes and hands back what it painted. */
function makeCanvas() {
  const ctx = new Proxy({ strokes: 0 }, {
    get: (target, key) => (key in target ? target[key] : key === 'stroke' ? () => (target.strokes += 1) : () => {}),
    set: (target, key, value) => ((target[key] = value), true),
  });
  return { getContext: () => ctx, transferToImageBitmap: () => ({ painted: ctx.strokes }), width: 1, height: 1 };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the globe draws what the flat map holds', () => {
  it('reads a geometry’s box and a source’s features', () => {
    expect(boundsOf({ type: 'Polygon', coordinates: [[[1, 2], [3, 4], [0, 5], [1, 2]]] })).toEqual({ west: 0, south: 2, east: 3, north: 5 });
    expect(boundsOf({ type: 'GeometryCollection', geometries: [{ type: 'Point', coordinates: [1, 1] }, { type: 'Point', coordinates: [4, -2] }] })).toEqual({ west: 1, south: -2, east: 4, north: 1 });
    const features = featuresOf({ type: 'FeatureCollection', features: [line([[0, 0], [1, 1]]), { type: 'Feature', geometry: null }] });
    expect(features).toHaveLength(1);
    expect(features[0]).toMatchObject({ type: 'LineString', bounds: { west: 0, east: 1 } });
  });

  it('repaints only where a source’s features changed', () => {
    const before = featuresOf({ type: 'FeatureCollection', features: [line([[0, 0], [1, 1]]), line([[10, 10], [11, 11]])] });
    const after = featuresOf({ type: 'FeatureCollection', features: [line([[0, 0], [1, 1]]), line([[20, 20], [21, 21]])] });
    expect(changedBounds(before, after)).toEqual({ west: 10, south: 10, east: 21, north: 21 });
    expect(changedBounds(before, before)).toBeNull();
  });

  it('reads the style, leaves out the layers it is told to, and paints a line where the source lays it', async () => {
    const map = stubMap();
    map.addLayer({ id: 'basemap-imagery', type: 'raster', source: 'imagery' });
    map.addLayer({ id: 'sfc-1-line', type: 'line', source: 'shapes', paint: { 'line-color': '#f00' } });
    map.addLayer({ id: 'sfc-1-dot', type: 'circle', source: 'shapes', filter: ['==', ['geometry-type'], 'Point'] });
    map.sources.set('imagery', { type: 'raster', tiles: ['/api/tiles/x/{z}/{x}/{y}'] });
    map.sources.set('shapes', { type: 'geojson', getData: async () => ({ type: 'FeatureCollection', features: [line([[6.9, 46.1], [7.1, 46.2]])] }) });
    const globe = stubGlobe();
    const mirror = createMirror(map, globe, { canvas: document.createElement('canvas'), exclude: (id) => id === 'basemap-imagery', makeCanvas });
    expect(mirror.entries.map((e) => e.id)).toEqual(['sfc-1-line', 'sfc-1-dot']);
    await settle();
    // the line's ground repainted, and a tile under it painted with one stroke
    expect(globe.invalidated.at(-1)).toMatchObject({ west: 6.9, east: 7.1 });
    const n = 2 ** 12;
    const x = Math.floor(((7 + 180) / 360) * n);
    const s = Math.sin((46.15 * Math.PI) / 180);
    const y = Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n);
    expect(await globe.laid.compose({ z: 12, x, y })).toEqual({ painted: 1 });
    expect(await globe.laid.compose({ z: 12, x: 0, y: 0 })).toBeNull();
    // a capture of the globe paints what stands on the ground through the same hand
    expect(globe.laid.paintMarks).toBe(mirror.paintMarks);
    mirror.destroy();
  });

  it('hears a change to the style and to a source, and paints them again', async () => {
    const map = stubMap();
    let features = [line([[0, 0], [1, 1]])];
    map.sources.set('shapes', { type: 'geojson', getData: async () => ({ type: 'FeatureCollection', features }) });
    map.addLayer({ id: 'a', type: 'line', source: 'shapes' });
    const globe = stubGlobe();
    const mirror = createMirror(map, globe, { canvas: document.createElement('canvas'), makeCanvas });
    await settle();
    map.addLayer({ id: 'b', type: 'fill', source: 'shapes' });
    map.emit('styledata');
    await settle();
    expect(mirror.entries.map((e) => e.id)).toEqual(['a', 'b']);
    expect(globe.invalidated.at(-1)).toBe('everywhere');
    features = [line([[5, 5], [6, 6]])];
    map.emit('sourcedata', { sourceId: 'shapes', sourceDataType: 'content' });
    await settle();
    expect(globe.invalidated.at(-1)).toEqual({ west: 0, south: 0, east: 6, north: 6 });
    mirror.destroy();
  });

  it('answers the flat map’s questions from the globe while it draws, and gives them back after', () => {
    const map = stubMap();
    const own = map.project;
    const globe = stubGlobe();
    const mirror = createMirror(map, globe, { canvas: document.createElement('canvas'), makeCanvas });
    expect(map.project([7, 46])).toMatchObject({ x: 70, y: 460 });
    expect(map.unproject([70, 460])).toMatchObject({ lng: 7, lat: 46 });
    expect(map.getBearing()).toBe(30);
    expect(map.getPitch()).toBe(40);
    // the flat map's hand rests, so a press on a marker over the globe moves nothing under it
    expect(map.dragPan.isEnabled()).toBe(false);
    mirror.destroy();
    expect(map.project).toBe(own);
    expect('unproject' in map).toBe(false);
    expect(map.dragPan.isEnabled()).toBe(true);
  });

  it('hands a press on the globe to the flat map as one of its own mouse events', () => {
    const map = stubMap();
    const globe = stubGlobe();
    const mirror = createMirror(map, globe, { canvas: document.createElement('canvas'), makeCanvas });
    globe.emit('pointer', { type: 'click', event: new MouseEvent('pointerup', { clientX: 70, clientY: 460 }) });
    expect(map.fired).toContain('click');
    expect(globe.setCursor).toHaveBeenCalled();
    mirror.destroy();
  });

  it('zooms the globe on a wheel over one of the flat map’s markers, held still meanwhile', () => {
    const map = stubMap();
    const container = document.createElement('div');
    const marker = document.createElement('div');
    container.append(marker);
    map.getContainer = () => container;
    const globe = { ...stubGlobe(), wheel: vi.fn(), onSurface: () => false };
    const mirror = createMirror(map, globe, { canvas: document.createElement('canvas'), makeCanvas });
    expect(map.scrollZoom.isEnabled()).toBe(false);
    marker.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: 70, clientY: 460, bubbles: true, cancelable: true }));
    expect(globe.wheel).toHaveBeenCalledTimes(1);
    expect(globe.wheel.mock.calls[0][0]).toMatchObject({ deltaY: -100 });
    mirror.destroy();
    marker.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true }));
    expect(globe.wheel).toHaveBeenCalledTimes(1);
  });

  it('projects a point once a frame whatever layers stand on it, and never weighs what a filter refuses', async () => {
    const map = stubMap();
    const pin = (lon, lat, own = false) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { own } });
    map.sources.set('pins', { type: 'geojson', getData: async () => ({ type: 'FeatureCollection', features: [pin(10, 10), pin(20, 20), pin(30, 30, true)] }) });
    map.addLayer({ id: 'dot', type: 'circle', source: 'pins', paint: { 'circle-radius': 4 } });
    map.addLayer({ id: 'hit', type: 'circle', source: 'pins', paint: { 'circle-radius': 12, 'circle-opacity': 0 } });
    map.addLayer({ id: 'own', type: 'circle', source: 'pins', filter: ['==', ['get', 'own'], true], paint: { 'circle-radius': 6 } });
    const globe = stubGlobe();
    const asked = [];
    globe.standingAt = (lat, lon) => (asked.push(lon), { x: lon * 10, y: lat * 10, distance: 1000 });
    const mirror = createMirror(map, globe, { canvas: makeCanvas(), makeCanvas });
    await settle();
    asked.length = 0;
    globe.laid.frame({ moved: true });
    // three points, each projected once for its two or three layers
    expect(asked.sort((a, b) => a - b)).toEqual([10, 20, 30]);
    expect(mirror.placed.map((m) => m.candidate.layer.id).sort()).toEqual(['dot', 'dot', 'dot', 'hit', 'hit', 'hit', 'own']);
    expect(mirror.placed.filter((m) => m.unseen).map((m) => m.candidate.layer.id)).toEqual(['hit', 'hit', 'hit']);
    mirror.destroy();
  });

  it('tells the flat map’s markers to move without drawing the flat map again under the globe', () => {
    const map = stubMap();
    const listeners = [];
    const repaints = [];
    // the engine answers its own `move` with a repaint; its markers answer it by placing themselves again
    Object.setPrototypeOf(map, { _update: () => repaints.push('flat') });
    map.on = (name, fn) => name === 'move' && listeners.push(fn);
    map.fire = (event) => (event === 'move' ? listeners.forEach((fn) => fn()) : null);
    map.on('move', () => map._update());
    const marker = vi.fn();
    map.on('move', marker);
    const globe = stubGlobe();
    const mirror = createMirror(map, globe, { canvas: makeCanvas(), makeCanvas });
    repaints.length = 0;
    marker.mockClear();
    globe.laid.frame({ moved: true });
    expect(marker).toHaveBeenCalledTimes(1);
    expect(repaints).toEqual([]);
    // the engine's own method is back for every other `move`
    expect(Object.prototype.hasOwnProperty.call(map, '_update')).toBe(false);
    map._update();
    expect(repaints).toEqual(['flat']);
    mirror.destroy();
  });

  it('finds a click target that paints nothing where its ground is now, though the view moved since it was placed', async () => {
    const map = stubMap();
    map.sources.set('pins', { type: 'geojson', getData: async () => ({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [20, 20] }, properties: { name: 'pin' } }] }) });
    map.addLayer({ id: 'hit', type: 'circle', source: 'pins', paint: { 'circle-radius': 12, 'circle-opacity': 0 } });
    const globe = stubGlobe();
    let shift = 0;
    globe.standingAt = (lat, lon) => ({ x: lon * 10 + shift, y: lat * 10, distance: 1000 });
    const mirror = createMirror(map, globe, { canvas: makeCanvas(), makeCanvas });
    await settle();
    globe.laid.frame({ moved: true });
    shift = 100;
    // the next frame comes before the next placement: the view moved, the unseen target waited
    globe.laid.frame({ moved: true });
    expect(mirror.placed[0].x).toBe(200);
    expect(map.queryRenderedFeatures([300, 200]).map((f) => f.properties.name)).toEqual(['pin']);
    expect(map.queryRenderedFeatures([200, 200])).toEqual([]);
    mirror.destroy();
  });

  it('finds the line and the dot under a click, top first, as the flat map’s hit test would', async () => {
    const map = stubMap();
    map.sources.set('shapes', {
      type: 'geojson',
      getData: async () => ({
        type: 'FeatureCollection',
        features: [line([[10, 20], [30, 20]], { name: 'road' }), { type: 'Feature', geometry: { type: 'Point', coordinates: [20, 20] }, properties: { name: 'pin' } }],
      }),
    });
    map.addLayer({ id: 'line', type: 'line', source: 'shapes', paint: { 'line-width': 2 } });
    map.addLayer({ id: 'dot', type: 'circle', source: 'shapes', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 6 } });
    const globe = stubGlobe();
    const mirror = createMirror(map, globe, { canvas: makeCanvas(), makeCanvas });
    await settle();
    globe.laid.frame({ moved: true });
    const hits = map.queryRenderedFeatures([200, 200]);
    expect(hits.map((f) => [f.layer.id, f.properties.name])).toEqual([['dot', 'pin'], ['line', 'road']]);
    expect(map.queryRenderedFeatures([200, 200], { layers: ['line'] }).map((f) => f.layer.id)).toEqual(['line']);
    mirror.destroy();
  });
});
