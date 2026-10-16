import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The options each map was made with, in order. */
const made = [];

vi.mock('maplibre-gl', () => {
  class MapLibreMap {
    constructor(options) {
      made.push(options);
      this.scrollZoom = { setWheelZoomRate: () => {} };
      this.keyboard = { disableRotation: () => {} };
    }
    once() { return Promise.resolve(); }
    on() {}
    addControl() {}
  }
  return { MapLibreMap, NavigationControl: class {}, ScaleControl: class {}, addProtocol: () => {}, setWorkerUrl: () => {} };
});
vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}));
vi.mock('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url', () => ({ default: '' }));
vi.mock('./engine.css', () => ({}));
vi.mock('./facade.js', () => ({ mapFacade: () => ({}), engineZoom: (zoom) => zoom }));

const { createMapEngine } = await import('./engine.js');

describe('a map engine', () => {
  beforeEach(() => { made.length = 0; });

  it('fades names and marks in as they are placed, unless a plate asks them put down at once', async () => {
    const view = { lat: 10, lon: 20, zoom: 5 };
    const box = () => ({ querySelector: () => null, classList: { add: () => {} }, dataset: {} });
    await createMapEngine(box(), { view, controls: false });
    await createMapEngine(box(), { view, controls: false, settle: false, fade: false });
    expect(made[0]).not.toHaveProperty('fadeDuration');
    expect(made[1].fadeDuration).toBe(0);
  });
});
