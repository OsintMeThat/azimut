// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/**
 * The home map: what it asks the engine for, and what it never asks for.
 *
 * The map itself is drawn in a real browser (`e2e/home-guide.spec.js`); what is
 * worth pinning here is the contract with `lib/map`, which a canvas cannot show.
 * Three halves of it: one basemap and no choice of one, the points framed once
 * rather than on every re-read, and nothing on the layer that writes.
 */

const fitPoints = vi.fn(() => true);
const engineDestroy = vi.fn();
const engine = { fitPoints, getZoom: () => 3, destroy: engineDestroy, impl: {} };
const createMapEngine = vi.fn(async () => engine);
vi.mock('../../lib/map/engine.js', () => ({ createMapEngine: (...args) => createMapEngine(...args) }));

const show = vi.fn();
const dispose = vi.fn();
vi.mock('../../lib/map/basemap.js', () => ({
  createBasemaps: () => ({ show, dispose, setLabels: vi.fn() }),
}));

const set = vi.fn();
const surfaceDestroy = vi.fn();
vi.mock('../../lib/map/surface.js', () => ({
  createSurface: () => ({ set, destroy: surfaceDestroy }),
}));

const PROVIDERS = [
  {
    id: 'esri-world-imagery',
    label: 'Esri World Imagery',
    attribution: 'Esri',
    max_zoom: 19,
    tile_size: 256,
    oversample: 1,
  },
  { id: 'mapbox', label: 'Mapbox Satellite', max_zoom: 22, tile_size: 512, oversample: 1, meter: 'mapbox' },
];
const get = vi.fn(async () => PROVIDERS);
vi.mock('../../lib/api.js', () => ({ api: { get: (...args) => get(...args) }, ApiError: Error }));

const { default: PlaceMap } = await import('./PlaceMap.svelte');
const { mapProps, resetMapProps } = await import('./placemap.fixture.svelte.js');

const PINS = [
  { id: 'p1', kind: 'place', title: 'Quai sud', lat: 49.98, lon: 36.25 },
  { id: 'p2', kind: 'capture', title: '', lat: 49.99, lon: 36.3 },
];

const opened = vi.fn();
let live = null;
let target = null;

async function settle() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
  flushSync();
}

async function open(over = {}) {
  target = document.createElement('div');
  document.body.append(target);
  resetMapProps({ pins: PINS, total: PINS.length, onopen: opened, ...over });
  live = mount(PlaceMap, { target, props: mapProps });
  flushSync();
  await settle();
  return target;
}

beforeEach(() => {
  vi.clearAllMocks();
  fitPoints.mockReturnValue(true);
  createMapEngine.mockResolvedValue(engine);
  get.mockResolvedValue(PROVIDERS);
});

afterEach(() => {
  if (live) unmount(live);
  live = null;
  target?.remove();
  target = null;
  document.body.innerHTML = '';
});

describe('the case on the home map', () => {
  it('shows the free imagery, and offers no other', async () => {
    await open();
    expect(get).toHaveBeenCalledWith('/api/satellite/providers');
    const [provider, id, cell] = show.mock.calls.at(-1);
    expect(provider.id).toBe('esri-world-imagery');
    expect(id).toBe('esri-world-imagery');
    expect(cell).toBe(256);
    expect(show).toHaveBeenCalledTimes(1);
    // no picker, no labels toggle, nothing that would spend a metered basemap
    expect(target.querySelector('select')).toBeNull();
  });

  it('frames the points it was handed, capped short of a rooftop', async () => {
    await open();
    const [points, options] = fitPoints.mock.calls.at(-1);
    expect(points).toEqual(PINS);
    expect(options.maxZoom).toBe(15);
    expect(options.padding).toBeGreaterThan(0);
  });

  it('draws one dot per point, named on hover where the row has a title', async () => {
    await open();
    const shapes = set.mock.calls.at(-1)[0];
    expect(shapes.map((shape) => shape.kind)).toEqual(['dot', 'dot']);
    expect(shapes[0]).toMatchObject({ id: 'p1', at: { lat: 49.98, lon: 36.25 } });
    expect(shapes[0].tip.text).toBe('Quai sud');
    // an untitled capture has nothing to read out, so it says nothing
    expect(shapes[1].tip).toBeUndefined();
  });

  it('draws nothing that writes: the map is a reading', async () => {
    await open();
    for (const shape of set.mock.calls.at(-1)[0]) {
      expect(shape.onClick).toBeUndefined();
      expect(shape.onContextMenu).toBeUndefined();
    }
  });

  it('leaves the camera alone when the same case is read again', async () => {
    await open();
    expect(fitPoints).toHaveBeenCalledTimes(1);
    // coming back to this tab re-reads the case and answers the same points: a
    // refit here would snatch the view back from wherever it was panned to
    mapProps.pins = PINS.map((pin) => ({ ...pin }));
    await settle();
    expect(fitPoints).toHaveBeenCalledTimes(1);
  });

  it('redraws and reframes when the points themselves change', async () => {
    await open();
    mapProps.pins = [{ id: 'p3', kind: 'place', title: 'Depot', lat: 12, lon: 77 }];
    mapProps.total = 1;
    await settle();
    expect(fitPoints).toHaveBeenCalledTimes(2);
    expect(set.mock.calls.at(-1)[0].map((shape) => shape.id)).toEqual(['p3']);
  });

  it('presses through to the map tool, and says how much of the case is drawn', async () => {
    await open({ pins: PINS, total: 9 });
    expect(target.textContent).toContain('9 points on the map');
    expect(target.textContent).toContain('2 drawn');
    target.querySelector('.foot').click();
    flushSync();
    expect(opened).toHaveBeenCalled();
  });

  it('says what it cannot draw when the browser refuses WebGL', async () => {
    createMapEngine.mockRejectedValue(new Error('no webgl'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await open();
    expect(target.textContent).toContain('needs WebGL');
    // the count is still true, and the way through to the map still works
    expect(target.textContent).toContain('2 points on the map');
    expect(get).not.toHaveBeenCalled();
  });

  it('still draws the case when the basemap catalogue cannot be read', async () => {
    get.mockRejectedValue(new Error('offline'));
    await open();
    expect(show).not.toHaveBeenCalled();
    expect(set.mock.calls.at(-1)[0]).toHaveLength(2);
  });

  it('takes the map down with it', async () => {
    await open();
    unmount(live);
    live = null;
    expect(dispose).toHaveBeenCalled();
    expect(surfaceDestroy).toHaveBeenCalled();
    expect(engineDestroy).toHaveBeenCalled();
  });
});
