import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The options each map was made with, in order, and the maps themselves. */
const made = [];
const built = [];
/** The tile protocols the engine registers, by name. */
const protocols = new Map();

vi.mock('maplibre-gl', () => {
  class MapLibreMap {
    constructor(options) {
      made.push(options);
      built.push(this);
      this.handlers = {};
      this.pitch = 0;
      this.scrollZoom = { setWheelZoomRate: () => {} };
      this.keyboard = { disableRotation: () => {} };
    }
    once() { return Promise.resolve(); }
    on(name, handler) { (this.handlers[name] ??= []).push(handler); }
    fire(name) { for (const handler of this.handlers[name] ?? []) handler(); }
    getPitch() { return this.pitch; }
    getTerrain() { return null; }
    addControl() {}
  }
  return {
    MapLibreMap,
    NavigationControl: class {},
    ScaleControl: class {},
    addProtocol: (name, handler) => protocols.set(name, handler),
    setWorkerUrl: () => {},
  };
});
vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}));
vi.mock('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url', () => ({ default: '' }));
vi.mock('./engine.css', () => ({}));
vi.mock('./facade.js', () => ({ mapFacade: (map, container, mapId) => ({ mapId }), engineZoom: (zoom) => zoom }));
/** What the app answers the next tile with. */
let answer = { data: new ArrayBuffer(0) };
vi.mock('./tileBatch.js', () => ({
  BATCH_PROTOCOL: 'batch',
  appTile: async () => answer,
  createTileBatcher: () => ({}),
  readBatched: (url) => JSON.parse(url),
}));

const { createMapEngine } = await import('./engine.js');

/** A map container the engine can mark. */
function box() {
  const classes = new Set();
  return {
    querySelector: () => null,
    classList: {
      add: (name) => classes.add(name),
      toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)),
      contains: (name) => classes.has(name),
    },
    dataset: {},
  };
}

describe('a map engine', () => {
  beforeEach(() => {
    made.length = 0;
    built.length = 0;
  });

  it('puts the scale bar away while the camera leans, since a tilted view has no one scale', async () => {
    const container = box();
    await createMapEngine(container, { view: { lat: 0, lon: 0, zoom: 4 } });
    const map = built.at(-1);
    map.pitch = 60;
    map.fire('pitch');
    expect(container.classList.contains('tilted')).toBe(true);
    map.pitch = 0;
    map.fire('pitch');
    expect(container.classList.contains('tilted')).toBe(false);
  });

  it('remembers a map some of whose relief the fallback drew, and only relief', async () => {
    const facade = await createMapEngine(box(), { view: { lat: 0, lon: 0, zoom: 4 } });
    const tile = (kind) => protocols.get('batch')({ url: JSON.stringify({ kind, mapId: facade.mapId }) }, new AbortController());
    answer = { data: new ArrayBuffer(0), fallback: false };
    await tile('terrain');
    expect(facade.drewReliefFallback()).toBe(false);
    answer = { data: new ArrayBuffer(0), fallback: true };
    await tile('imagery');
    expect(facade.drewReliefFallback()).toBe(false);
    await tile('terrain');
    expect(facade.drewReliefFallback()).toBe(true);
  });

  it('fades names and marks in as they are placed, unless a plate asks them put down at once', async () => {
    const view = { lat: 10, lon: 20, zoom: 5 };
    await createMapEngine(box(), { view, controls: false });
    await createMapEngine(box(), { view, controls: false, settle: false, fade: false });
    expect(made[0]).not.toHaveProperty('fadeDuration');
    expect(made[1].fadeDuration).toBe(0);
  });
});
