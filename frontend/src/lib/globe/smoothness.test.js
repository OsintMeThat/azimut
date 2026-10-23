// @vitest-environment happy-dom
/**
 * What keeps the 3D view smooth with layers on, held as counts rather than
 * frames per second, which no two machines agree on. Each one stood for a lag
 * the analyst saw (2026-10-23): a personal layer of a few thousand features
 * turned the view at a third of its pace, and names in view were weighed again
 * every frame instead of a few times a second.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAddedLayer } from '../map/addedLayer.js';
import { createMirror } from './mirror.js';

/** The flat map as both a personal layer and the mirror use it: style, GeoJSON sources, images, events. */
function stubMap() {
  const sources = new Map();
  const layers = new Map();
  const images = new Set();
  const listeners = new Map();
  const repaints = [];
  const map = {
    sources,
    layers,
    repaints,
    addSource: (id, spec) => sources.set(id, { ...spec }),
    getSource: (id) => {
      const held = sources.get(id);
      if (!held) return undefined;
      return {
        type: held.type,
        setData: (data) => (held.data = data),
        getData: async () => held.data,
      };
    },
    removeSource: (id) => sources.delete(id),
    addLayer: (layer) => layers.set(layer.id, { ...layer }),
    getLayer: (id) => (layers.has(id) ? { ...layers.get(id), serialize: () => layers.get(id) } : undefined),
    getLayersOrder: () => [...layers.keys()],
    removeLayer: (id) => layers.delete(id),
    moveLayer: () => {},
    setFilter: (id, filter) => layers.set(id, { ...layers.get(id), filter }),
    setPaintProperty: (id, key, value) => layers.set(id, { ...layers.get(id), paint: { ...layers.get(id).paint, [key]: value } }),
    setLayoutProperty: (id, key, value) => layers.set(id, { ...layers.get(id), layout: { ...layers.get(id).layout, [key]: value } }),
    hasImage: (name) => images.has(name),
    addImage: (name) => images.add(name),
    getImage: () => null,
    getCanvas: () => ({ style: {} }),
    on: (type, handler) => typeof handler === 'function' && listeners.set(type, [...(listeners.get(type) ?? []), handler]),
    off: () => {},
    fire: (event) => (listeners.get(typeof event === 'string' ? event : event.type) ?? []).forEach((fn) => fn()),
  };
  // the engine draws itself again on every `move` it hears
  Object.setPrototypeOf(map, { _update: () => repaints.push(1) });
  map.on('move', () => map._update());
  return map;
}

/** A canvas whose text is 7 px a letter, counting what is drawn and written on it. */
function countingCanvas(counts) {
  const ctx = new Proxy(
    {},
    {
      get: (_, key) => {
        if (key === 'measureText') return (text) => ((counts.measured += 1), { width: text.length * 7 });
        if (key === 'fillText') return () => (counts.written += 1);
        if (key === 'arc') return () => (counts.dots += 1);
        return () => {};
      },
      set: () => true,
    }
  );
  return () => ({ getContext: () => ctx, transferToImageBitmap: () => ({}), width: 1, height: 1 });
}

/** The globe: an 800 × 600 view where a point stands at its degrees × 100, counting what it is asked. */
function stubGlobe(counts) {
  return {
    laid: null,
    invalidate() {},
    redraw() {},
    setLaid(laid) {
      this.laid = laid;
    },
    on: () => () => {},
    drawnTiles: () => [],
    size: () => ({ width: 800, height: 600 }),
    standingAt: (lat, lon) => ((counts.projected += 1), { x: lon * 100, y: lat * 100, distance: 1000 }),
    zoomAt: () => ((counts.weighed += 1), 12),
    heading: () => 0,
    camera: () => ({ lat: 3, lon: 4, zoom: 12, bearing: 0, pitch: 60 }),
    containerPointToLatLng: ({ x, y }) => ({ lat: y / 100, lon: x / 100 }),
    getZoom: () => 13,
    metresPerPixelAt: () => 1,
    setCursor() {},
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the 3D view with layers on, held to its budget', () => {
  let now = 0;
  beforeEach(() => {
    now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', () => 0);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('projects a personal layer’s points once a frame, never draws its click targets, and leaves the flat map still', async () => {
    const map = stubMap();
    const engine = { impl: map, claimClicks: () => () => {}, fitBounds: () => {} };
    const layer = createAddedLayer(engine, { editable: true, buildPersonal: () => null, buildBadge: () => null });
    const points = Array.from({ length: 1800 }, (_, i) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0.2 + (i % 60) * 0.12, 0.2 + Math.floor(i / 60) * 0.18] },
      properties: { key: `k${i}`, name: `P${i}`, category: 'G' },
    }));
    await layer.set({ type: 'FeatureCollection', features: points }, { categories: [{ name: 'G', colour: '#0072b2' }] });
    const counts = { projected: 0, weighed: 0, measured: 0, written: 0, dots: 0 };
    const globe = stubGlobe(counts);
    const mirror = createMirror(map, globe, { canvas: countingCanvas(counts)(), makeCanvas: countingCanvas(counts) });
    await settle();
    // once, as the globe takes over, for the markers to stand where it shows them
    map.repaints.length = 0;

    globe.laid.frame({ moved: true });
    // every standing layer of the personal layer stands on one point: one projection each
    expect(counts.projected).toBe(1800);
    // its dots and its invisible click targets, and nothing a filter refuses at every zoom (its own icons, bearings, names)
    expect(mirror.placed.length).toBe(3600);
    expect(mirror.placed.filter((mark) => mark.unseen).length).toBe(1800);
    expect(counts.dots).toBe(1800);

    // the next frames, before the next placement: the drawn marks follow the view, the click targets wait
    counts.projected = 0;
    counts.dots = 0;
    now += 16;
    globe.laid.frame({ moved: true });
    expect(counts.projected).toBe(1800);
    expect(counts.dots).toBe(1800);
    // the flat map under the globe was never drawn again for it
    expect(map.repaints).toEqual([]);
    mirror.destroy();
    layer.destroy();
  });

  it('writes only the names that fit and weighs them a few times a second, not every frame', async () => {
    const map = stubMap();
    // two thousand villages in view, crowded: most give way to another
    const villages = Array.from({ length: 2000 }, (_, i) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0.1 + (i % 50) * 0.15, 0.1 + Math.floor(i / 50) * 0.14] },
      properties: { name: `Village ${i}` },
    }));
    map.addSource('places', { type: 'geojson', data: { type: 'FeatureCollection', features: villages } });
    map.addLayer({ id: 'names', type: 'symbol', source: 'places', layout: { 'text-field': ['get', 'name'], 'text-size': 12 }, paint: { 'text-color': '#fff' } });
    const counts = { projected: 0, weighed: 0, measured: 0, written: 0, dots: 0 };
    const globe = stubGlobe(counts);
    const mirror = createMirror(map, globe, { canvas: countingCanvas(counts)(), makeCanvas: countingCanvas(counts) });
    await settle();

    // a second of a moving view, a frame every 16 ms
    let placings = 0;
    for (let frame = 0; frame < 60; frame += 1) {
      const before = counts.weighed;
      globe.laid.frame({ moved: true });
      if (counts.weighed > before) placings += 1;
      now += 16;
    }
    const kept = mirror.placed.filter((mark) => mark.label).length;
    expect(kept).toBeGreaterThan(50);
    expect(kept).toBeLessThan(500);
    expect(mirror.placed.waiting).toBe(false);
    // every name is measured, only those kept are written, once each
    expect(counts.written).toBe(kept);
    // four placings a second, and the few it takes to write the names kept
    expect(placings).toBeLessThanOrEqual(10);
    mirror.destroy();
  });
});
