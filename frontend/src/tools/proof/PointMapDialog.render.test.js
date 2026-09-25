// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/**
 * Moving a proof's point on the ground rather than in digits.
 *
 * The map itself is drawn by the engine and cannot be asserted here, so what is
 * pinned is the contract around it: where it opens, that the pin follows a
 * click, what the dialog hands back, and that it writes nothing — a coordinate
 * row is the only thing this dialog is allowed to change.
 */

const PROVIDERS = [
  {
    id: 'esri-world-imagery',
    label: 'Esri World Imagery',
    imagery: true,
    max_zoom: 19,
    tile_size: 256,
    oversample: 1,
  },
];

const get = vi.fn(async (path) => {
  if (path === '/api/satellite/providers') return PROVIDERS;
  if (path === '/api/settings') return { usage: {}, month: '2026-09' };
  if (path.includes('/imagery-date')) return { supported: false };
  return {};
});
const post = vi.fn(async () => ({}));
const put = vi.fn(async () => ({}));
vi.mock('../../lib/api.js', () => ({ api: { get, post, put, patch: vi.fn(), del: vi.fn() } }));

vi.mock('../../lib/state.svelte.js', () => ({
  prefs: { coordFormat: 'dd', units: 'metric', homeView: { lat: 43, lon: 25, zoom: 3 } },
}));

const engines = [];
function fakeEngine(opening, container) {
  const handlers = {};
  const engine = {
    handlers,
    impl: { on: vi.fn(), off: vi.fn() },
    container,
    camera: vi.fn(() => ({ ...opening, bearing: 0 })),
    getZoom: vi.fn(() => opening.zoom),
    setBearing: vi.fn(),
    resize: vi.fn(),
    on: vi.fn((name, handler) => {
      handlers[name] = handler;
      return () => delete handlers[name];
    }),
    destroy: vi.fn(),
  };
  engines.push(engine);
  return engine;
}
vi.mock('../../lib/map/engine.js', () => ({
  createMapEngine: vi.fn(async (element, { view }) => fakeEngine(view, element)),
}));

const setOverlay = vi.fn();
vi.mock('../../lib/map/basemap.js', () => ({
  OVERLAY_IDS: ['roads', 'boundaries', 'railway', 'power', 'seamarks', 'gpstraces'],
  createBasemaps: vi.fn(() => ({
    show: vi.fn(),
    setOverlay,
    setZoomCeiling: vi.fn(),
    dispose: vi.fn(),
  })),
}));

const set = vi.fn();
const patch = vi.fn();
const destroy = vi.fn();
vi.mock('../../lib/map/surface.js', () => ({
  createSurface: vi.fn(() => ({ set, patch, destroy })),
}));

const { default: PointMapDialog } = await import('./PointMapDialog.svelte');

const VIEW = { lat: 48.8584, lon: 2.2945, zoom: 17 };

let live;
const onpick = vi.fn();
const onclose = vi.fn();

async function settle() {
  for (let index = 0; index < 40; index += 1) await Promise.resolve();
  flushSync();
}

async function open(view = VIEW) {
  const target = document.createElement('div');
  document.body.append(target);
  live = mount(PointMapDialog, { target, props: { view, onpick, onclose } });
  flushSync();
  await settle();
}

const button = (label) =>
  [...document.querySelectorAll('button')].find((entry) => entry.textContent.trim() === label);

beforeEach(() => {
  vi.clearAllMocks();
  engines.length = 0;
});

afterEach(() => {
  if (live) unmount(live);
  live = null;
  document.body.innerHTML = '';
});

describe('moving a proof point on the map', () => {
  it('opens on the view it was handed, with the pin on it', async () => {
    await open();

    const [{ view }] = (await import('../../lib/map/engine.js')).createMapEngine.mock.calls.map(
      ([, options]) => options
    );
    expect(view).toMatchObject(VIEW);
    const [[shapes]] = set.mock.calls;
    expect(shapes).toHaveLength(1);
    expect(shapes[0]).toMatchObject({ kind: 'marker', at: { lat: 48.8584, lon: 2.2945 } });
    expect(shapes[0].draggable).toBe(true);
    expect(document.body.textContent).toContain('Click the map to move the pin.');
    expect(document.body.textContent).toContain('48.858400, 2.294500');
  });

  it('follows a click, without rebuilding the layer under the pin', async () => {
    await open();
    set.mockClear();

    engines[0].handlers.click({ lat: 48.873792, lon: 2.295028 });
    flushSync();

    expect(set).not.toHaveBeenCalled();
    expect(patch).toHaveBeenLastCalledWith('point', { at: { lat: 48.873792, lon: 2.295028 } });
    expect(document.body.textContent).toContain('48.873792, 2.295028');
  });

  it('hands the point back and closes, or closes with nothing said', async () => {
    await open();
    engines[0].handlers.click({ lat: 1.5, lon: -2.25 });
    flushSync();

    button('Use this point').click();
    expect(onpick).toHaveBeenCalledWith({ lat: 1.5, lon: -2.25 });
    expect(onclose).toHaveBeenCalled();

    onpick.mockClear();
    button('Cancel').click();
    expect(onpick).not.toHaveBeenCalled();
  });

  it('offers the reference layers, the borders already on for their place names', async () => {
    await open();

    expect(setOverlay).toHaveBeenCalledWith('boundaries', true, null);
    expect(setOverlay).toHaveBeenCalledWith('railway', false, undefined);

    button('Layers').click();
    flushSync();
    const names = [...document.querySelectorAll('.layers .name')].map((entry) =>
      entry.textContent.trim()
    );
    expect(names).toEqual([
      'Borders',
      'Roads',
      'Railways',
      'Power lines',
      'Sea marks',
      'GPS traces',
    ]);

    setOverlay.mockClear();
    [...document.querySelectorAll('.layers button')]
      .find((entry) => entry.getAttribute('aria-label') === 'Railways')
      .click();
    await settle();
    expect(setOverlay).toHaveBeenCalledWith('railway', true, null);
  });

  it('writes nothing: the dialog answers one question and files nothing', async () => {
    await open();
    engines[0].handlers.click({ lat: 1, lon: 2 });
    flushSync();
    button('Use this point').click();

    expect(post).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });
});
