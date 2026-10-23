// @vitest-environment happy-dom
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
    addControl() {}
    getCanvas() { return null; }
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
vi.mock('./tileBatch.js', async (importOriginal) => ({ ...(await importOriginal()), appTile: async () => ({ data: new ArrayBuffer(0) }) }));

const { createMapEngine, dropDraggedClicks } = await import('./engine.js');

/** A map container the engine can mark. */
function box() {
  const classes = new Set();
  return {
    querySelector: () => null,
    addEventListener: () => {},
    classList: {
      add: (name) => classes.add(name),
      toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)),
      contains: (name) => classes.has(name),
    },
    dataset: {},
  };
}

describe('the tiles a map asks the app for', () => {
  it('asks a free provider’s tiles in batches, through a protocol of its own', async () => {
    const asked = [];
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      asked.push(url);
      const body = new TextEncoder().encode('png');
      const head = new Uint8Array(8);
      const view = new DataView(head.buffer);
      view.setUint16(0, 0, true);
      view.setUint16(2, 200, true);
      view.setUint32(4, body.length, true);
      return { ok: true, status: 200, body: new ReadableStream({ start: (c) => (c.enqueue(new Uint8Array([...head, ...body])), c.close()) }) };
    }));
    try {
      const handler = protocols.get('azimut-tiles');
      const tile = await handler({ url: 'azimut-tiles://esri-world-imagery/5/1/1' }, new AbortController());
      expect(new TextDecoder().decode(tile.data)).toBe('png');
      expect(asked).toEqual(['/api/tiles/batch/esri-world-imagery?t=5/1/1']);
      await expect(handler({ url: '/api/tiles/esri-world-imagery/5/1/1' }, new AbortController())).rejects.toThrow('not a batched tile address');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

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

  it('fades names and marks in as they are placed, unless a plate asks them put down at once', async () => {
    const view = { lat: 10, lon: 20, zoom: 5 };
    await createMapEngine(box(), { view, controls: false });
    await createMapEngine(box(), { view, controls: false, settle: false, fade: false });
    expect(made[0]).not.toHaveProperty('fadeDuration');
    expect(made[1].fadeDuration).toBe(0);
  });

  it('keeps the end of a drag from reaching the map as a click, whoever moved the camera', () => {
    const container = document.createElement('div');
    const canvas = document.createElement('canvas');
    const card = document.createElement('button');
    container.append(canvas, card);
    const gone = new AbortController();
    dropDraggedClicks(container, canvas, gone.signal);
    const clicks = [];
    canvas.addEventListener('click', () => clicks.push('canvas'));
    card.addEventListener('click', () => clicks.push('card'));
    const press = (target, x, y, button = 0) =>
      target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, button }));
    const click = (target, x, y) => target.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));

    press(canvas, 100, 100); click(canvas, 101, 102);
    expect(clicks).toEqual(['canvas']);
    // a pan: the hand let go far from where it pressed
    press(canvas, 100, 100); click(canvas, 160, 130);
    expect(clicks).toEqual(['canvas']);
    // a card or a marker over the map answers its own click
    press(card, 100, 100); click(card, 160, 130);
    expect(clicks).toEqual(['canvas', 'card']);
    gone.abort();
    press(canvas, 100, 100); click(canvas, 160, 130);
    expect(clicks).toEqual(['canvas', 'card', 'canvas']);
  });
});
