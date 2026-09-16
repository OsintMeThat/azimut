// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const PROVIDERS = [
  {
    id: 'esri-world-imagery',
    label: 'Esri World Imagery',
    imagery: true,
    max_zoom: 19,
    tile_size: 256,
    oversample: 1,
  },
  {
    id: 'esri-wayback',
    label: 'Esri Wayback',
    imagery: true,
    max_zoom: 19,
    tile_size: 256,
    oversample: 1,
  },
];

const SESSION = {
  azimut_compare: 1,
  title: 'Harbour change',
  spec: {
    version: 2,
    camera: { lat: 43.3, lon: 5.4, zoom: 18, bearing: 27 },
    mode: 'swipe',
    divider: 61,
    opacity: 44,
    change_assist: { sensitivity: 60, opacity: 75 },
    annotations: [
      { id: 'before', kind: 'text', colour: '#f6a81a', points: [[5.4, 43.3]], text: 'Before' },
    ],
    a: { present: true, provider: 'esri-world-imagery', overlays: ['roads'] },
    b: { present: true, provider: 'esri-wayback', overlays: ['railway'] },
  },
};

const RECIPE = {
  id: 'pair', name: 'Large surface change', description: 'Changes to review',
  phenomenon: 'Change', method: 'colour', providers: ['esri-wayback', 'sentinel2'], zones: [],
  colour: '#f6a81a', style: 'both',
  parameters: { sensitivity: 55, min_area: 20, min_score: 0, cleanup: 1, smoothing: 0,
    normalize: false, index: 'ndvi', direction: 'both', ignore_clouds: true,
    ignore_shadows: true, merge_metres: 0 },
};
const ANALYZERS = {
  builtins: [RECIPE, { ...RECIPE, id: 'solo', name: 'Vessels on water', method: 'vessels',
    providers: ['sentinel2'] }],
  custom: [],
  methods: [
    { id: 'colour', label: 'Colour change', single: false, sentinel_only: false, classes: false },
    { id: 'vessels', label: 'Infrared contrast over water', single: true, sentinel_only: true, classes: true },
  ],
  max_tiles: 4096, max_results: 2000,
  grids: { sentinel2: [13, 512], 'esri-wayback': [19, 256] },
};

const get = vi.fn(async (path) => {
  if (path === '/api/compare/analyzers') return structuredClone(ANALYZERS);
  if (path.startsWith('/api/cases/case-a/analysis/')) return [];
  if (path === '/api/satellite/providers') return PROVIDERS;
  if (path === '/api/firms/sensors') {
    return {
      keyed: true,
      sensors: [
        { id: 'viirs', label: 'VIIRS (S-NPP + NOAA-20)' },
        { id: 'modis', label: 'MODIS (Terra + Aqua)' },
      ],
    };
  }
  if (path === '/api/settings') return { usage: {}, month: '2026-09' };
  if (path.includes('/satellite/index')) return [];
  if (path.includes('/imagery-date')) return { supported: true, date: '2024-01-02' };
  if (path === '/api/satellite/wayback/releases') return { releases: [] };
  if (path === '/api/cases/case-a/compare/sessions') {
    return [{ name: 'Harbour change', title: 'Harbour change', provider_a: 'esri-world-imagery', provider_b: 'esri-wayback', mode: 'swipe' }];
  }
  if (path === '/api/cases/case-a/compare/sessions/Harbour%20change') return SESSION;
  return {};
});
const post = vi.fn(async (path) => {
  if (path === '/api/cases/case-a/compare/sessions') {
    return { name: 'Comparison', title: 'Comparison', spec_path: 'comparisons/.meta/Comparison.json' };
  }
  return { file: 'comparison.png', path: '' };
});
vi.mock('../lib/api.js', () => ({
  api: { get, post, put: vi.fn(), patch: vi.fn(), del: vi.fn() },
}));

const toast = vi.fn();
const ensureCase = vi.fn(async () => ({ id: 'case-a' }));
const reloadCase = vi.fn(async () => {});
const caseState = { current: { id: 'case-a' } };
vi.mock('../lib/state.svelte.js', () => ({
  caseState,
  ensureCase,
  prefs: { homeView: { lat: 48.8566, lon: 2.3522, zoom: 16 }, units: 'metric' },
  prefsReady: Promise.resolve(),
  reloadCase,
  toast,
  uiState: { tool: 'compare', openCompare: null },
}));

const engines = [];
function fakeEngine(opening, container) {
  const handlers = {};
  let camera = { ...opening, bearing: 0 };
  const engine = {
    handlers,
    impl: { on: vi.fn(), off: vi.fn() },
    frame: vi.fn(() => ({ lng: camera.lon, lat: camera.lat, zoom: camera.zoom - 1, bearing: camera.bearing })),
    follow: vi.fn((frame) => { camera = { lon: frame.lng, lat: frame.lat, zoom: frame.zoom + 1, bearing: frame.bearing }; }),
    following: () => false,
    camera: vi.fn(() => ({ ...camera })),
    getZoom: vi.fn(() => camera.zoom),
    container,
    setBearing: vi.fn((bearing) => (camera.bearing = bearing)),
    setView: vi.fn((view, zoom) => (camera = { ...camera, ...view, zoom })),
    syncView: vi.fn((view, zoom) => (camera = { ...camera, ...view, zoom })),
    resize: vi.fn(),
    snapshot: vi.fn(() => ({ width: 400, height: 300 })),
    containerPointToLatLng: vi.fn(({ x, y }) => ({ lat: y, lon: x })),
    latLngToContainerPoint: vi.fn(({ lat, lon }) => ({ x: lon, y: lat })),
    panBy: vi.fn(),
    on: vi.fn((name, handler) => {
      // MapLibre has already moved when it emits these notifications. Mirror
      // that in the façade double so the component's camera-alignment guard
      // sees the same state a real surface would expose.
      handlers[name] = (next) => {
        if (name === 'rotate' || name === 'view-change' || name === 'view-settled') {
          camera = { ...camera, ...next };
        }
        handler(next);
      };
      return () => delete handlers[name];
    }),
    destroy: vi.fn(),
  };
  engines.push(engine);
  return engine;
}

vi.mock('../lib/map/engine.js', () => ({
  createMapEngine: vi.fn(async (element, { view }) => fakeEngine(view, element)),
}));
vi.mock('../lib/map/basemap.js', () => ({
  OVERLAY_IDS: [],
  createBasemaps: vi.fn(() => ({
    show: vi.fn(),
    setOverlay: vi.fn(),
    setZoomCeiling: vi.fn(),
    dispose: vi.fn(),
  })),
}));

const { default: Compare } = await import('./Compare.svelte');

let live;
let target;

async function settle() {
  for (let index = 0; index < 60; index += 1) await Promise.resolve();
  flushSync();
}

async function open() {
  target = document.createElement('div');
  document.body.append(target);
  live = mount(Compare, { target });
  flushSync();
  await settle();
}

function button(label, root = document) {
  return [...root.querySelectorAll('button')].find((entry) => entry.textContent.trim().includes(label));
}

async function add(slot, provider = 'Esri World Imagery') {
  const empty = [...target.querySelectorAll('.empty-slot')].find(
    (entry) => entry.querySelector('.slot-letter').textContent === slot
  );
  empty.click();
  flushSync();
  [...document.querySelectorAll('.provider-card')]
    .find((entry) => entry.textContent.includes(provider))
    .click();
  flushSync();
  await settle();
}

beforeEach(() => {
  vi.clearAllMocks();
  engines.length = 0;
});

afterEach(() => {
  if (live) unmount(live);
  live = null;
  target?.remove();
  target = null;
  document.body.innerHTML = '';
});

describe('Compare', () => {
  it('opens empty and asks before any imagery is loaded', async () => {
    await open();
    expect(target.querySelector('h2').textContent).toBe('Compare');
    expect(target.querySelectorAll('.empty-slot')).toHaveLength(2);
    expect(target.querySelectorAll('.surface-shell')).toHaveLength(0);
    expect(engines).toHaveLength(0);
    expect(get).toHaveBeenCalledWith('/api/satellite/providers');
  });

  it('adds two independent surfaces and then offers every comparison mode', async () => {
    await open();
    await add('A');
    expect(engines).toHaveLength(1);
    expect(target.querySelectorAll('.surface-shell')).toHaveLength(1);

    await add('B', 'Esri Wayback');
    expect(engines).toHaveLength(2);
    expect(target.querySelectorAll('.surface-shell')).toHaveLength(2);
    expect([...target.querySelectorAll('.mode-btn')].map((entry) => entry.textContent.trim())).toEqual([
      'Side by side',
      'Swipe',
      'Fade',
      'Blink',
      'Difference',
      'Detect',
    ]);
    // The second surface opens on the first camera without needing a corrective move.
    expect(engines[1].camera()).toEqual(engines[0].camera());
    expect(target.querySelectorAll('.source-card')).toHaveLength(2);
    expect(target.querySelectorAll('.source-card button[aria-label="Imagery provider"]')).toHaveLength(2);
    expect(
      target.querySelector('.compare-bar').compareDocumentPosition(target.querySelector('.source-bar')) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    // One camera, so one compass in the bar and none on either surface.
    expect(target.querySelectorAll('button[aria-label="Reset to north"]')).toHaveLength(1);
    expect(target.querySelector('.surface-shell button[aria-label="Reset to north"]')).toBeNull();
  });

  it('keeps the cameras together and exposes the swipe and opacity controls', async () => {
    await open();
    await add('A');
    await add('B');

    const next = { lat: 43.3, lon: 5.4, zoom: 18.37, bearing: 32 };
    engines[0].handlers.rotate(next);
    engines[0].handlers['view-settled'](next);
    await settle();
    expect(target.querySelector('.camera-readout').textContent).toContain('z18.4');
    // The bar's compass reads the shared turn and puts it back to north.
    expect(target.querySelector('button[aria-label="Reset to north"] + button').textContent.trim()).toBe('32°');
    target.querySelector('button[aria-label="Reset to north"]').click();
    flushSync();
    expect(engines[0].setBearing).toHaveBeenCalledWith(0);

    button('Swipe', target).click();
    flushSync();
    expect(target.querySelector('.compare-stage').classList.contains('swipe')).toBe(true);
    expect(target.querySelector('input[aria-label="Swipe divider"]')).toBeNull();
    const divider = target.querySelector('button[aria-label="Swipe divider on imagery"]');
    divider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    flushSync();
    expect(target.querySelector('.compare-stage').style.getPropertyValue('--divider')).toBe('52%');

    button('Fade', target).click();
    flushSync();
    expect(target.querySelector('.overlay-legend')).toBeNull();
    const opacity = target.querySelector('input[aria-label="B opacity"]');
    opacity.value = '25';
    opacity.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(target.querySelector('.compare-stage').style.getPropertyValue('--opacity')).toBe('0.25');
  });

  it('toggles only the difference overlay from its eye button', async () => {
    await open();
    await add('A');
    await add('B', 'Esri Wayback');
    button('Difference', target).click();
    flushSync();
    await settle();

    const eye = () => target.querySelector('button[aria-label*="difference overlay"]');
    expect(eye().getAttribute('aria-label')).toBe('Hide the difference overlay');
    eye().click();
    flushSync();
    expect(eye().getAttribute('aria-label')).toBe('Show the difference overlay');
    expect(eye().getAttribute('aria-pressed')).toBe('false');
    eye().click();
    flushSync();
    expect(eye().getAttribute('aria-label')).toBe('Hide the difference overlay');
    expect(eye().getAttribute('aria-pressed')).toBe('true');
  });

  it('lays the difference over one image or over both, from the same switch', async () => {
    await open();
    await add('A');
    await add('B', 'Esri Wayback');
    button('Difference', target).click();
    flushSync();
    await settle();

    const stage = () => target.querySelector('.compare-stage');
    const base = (label) => [...target.querySelectorAll('[aria-label="Image under the highlights"] button')]
      .find((entry) => entry.textContent.trim() === label);
    // B alone: the two maps are stacked, and only one of them is read.
    expect(base('B').getAttribute('aria-pressed')).toBe('true');
    expect(stage().classList.contains('base-b')).toBe(true);

    base('Both').click();
    flushSync();
    await settle();
    // Both: the pair is side by side again, with the same reading on each.
    expect(stage().classList.contains('overlay')).toBe(false);
    expect(stage().classList.contains('base-b')).toBe(false);
    expect(target.textContent).toContain('Both images, the same highlights on each.');

    base('A').click();
    flushSync();
    expect(stage().classList.contains('base-a')).toBe(true);
  });

  it('gives each computing mode the same column, and only one at a time', async () => {
    await open();
    await add('A');
    await add('B', 'Esri Wayback');
    expect(target.querySelector('.cmp-dock')).toBeNull();

    button('Difference', target).click();
    flushSync();
    await settle();
    expect([...target.querySelectorAll('.cmp-dock')].map((dock) => dock.getAttribute('aria-label')))
      .toEqual(['Difference']);

    button('Detect', target).click();
    flushSync();
    await settle();
    expect([...target.querySelectorAll('.cmp-dock')].map((dock) => dock.getAttribute('aria-label')))
      .toEqual(['Detect']);
    // Detect works over an undivided pair, whatever reading mode preceded it.
    expect(target.querySelector('.compare-stage').classList.contains('overlay')).toBe(false);

    button('Side by side', target).click();
    flushSync();
    expect(target.querySelector('.cmp-dock')).toBeNull();
  });

  it('pauses blink on the side that is currently shown', async () => {
    vi.useFakeTimers();
    try {
      await open();
      await add('A');
      await add('B');
      button('Blink', target).click();
      flushSync();
      await settle();
      expect((target.querySelector('.secondary').classList.contains('blink-hidden') ? 'A' : 'B')).toBe('A');

      vi.advanceTimersByTime(800);
      flushSync();
      expect((target.querySelector('.secondary').classList.contains('blink-hidden') ? 'A' : 'B')).toBe('B');

      target.querySelector('[aria-label="Pause blink"]').click();
      flushSync();
      vi.advanceTimersByTime(1600);
      flushSync();
      expect((target.querySelector('.secondary').classList.contains('blink-hidden') ? 'A' : 'B')).toBe('B');
    } finally {
      vi.useRealTimers();
    }
  });

  it('removes one surface without losing the other', async () => {
    await open();
    await add('A');
    await add('B');
    target.querySelector('button[aria-label="Remove imagery A"]').click();
    flushSync();
    expect(target.querySelectorAll('.surface-shell')).toHaveLength(1);
    expect(target.querySelector('.surface-label strong').textContent).toBe('B');
    expect(target.querySelectorAll('.mode-btn')).toHaveLength(0);
  });

  it('warns before discarding an unsaved comparison', async () => {
    await open();
    await add('A');
    button('New', target).click();
    flushSync();

    const warning = document.querySelector('[role="alertdialog"]');
    expect(warning.textContent).toContain('Discard unsaved changes?');
    button('Cancel', warning).click();
    flushSync();
    expect(target.querySelectorAll('.surface-shell')).toHaveLength(1);

    button('New', target).click();
    flushSync();
    button('Discard changes', document.querySelector('[role="alertdialog"]')).click();
    flushSync();
    expect(target.querySelectorAll('.empty-slot')).toHaveLength(2);
  });

  it('gives each source its own layers and keeps export choices in one modal', async () => {
    await open();
    await add('A');
    await add('B');

    target.querySelector('[aria-label="Layers on imagery A"]').click();
    flushSync();
    const layers = document.querySelector('[role="dialog"]');
    expect(layers.getAttribute('aria-label')).toBe('Layers · A / B');
    expect(layers.querySelectorAll('.layer-pane')).toHaveLength(2);
    expect(layers.querySelectorAll('.layer-row')).toHaveLength(20);
    expect(layers.textContent).toContain('Active fires');
    expect(layers.textContent).toContain('Night lights');
    expect(layers.textContent).toContain('Saved work');
    const paneA = layers.querySelector('.layer-pane');
    paneA.querySelector('button[aria-label="Show Roads on imagery A"]').click();
    flushSync();
    expect(target.querySelectorAll('.source-card .layers')[0].textContent).toContain('1');
    paneA.querySelector('button[aria-label="Show Night lights on imagery A"]').click();
    flushSync();
    expect(target.querySelectorAll('.source-card .layers')[0].textContent).toContain('2');
    expect(paneA.textContent).toContain('NOAA-20');
    expect(paneA.querySelectorAll('.day-picker')).toHaveLength(1);
    paneA.querySelector('button[aria-label="Show Active fires on imagery A"]').click();
    flushSync();
    expect(paneA.textContent).toContain('VIIRS');
    expect(paneA.textContent).toContain('24 h');
    const dates = [...paneA.querySelectorAll('.chips button')].find((entry) => entry.textContent.trim() === 'Custom');
    dates.click();
    flushSync();
    expect(paneA.querySelectorAll('.day-picker')).toHaveLength(3);

    button('Export', target).click();
    await settle();
    const output = document.querySelector('[role="dialog"]');
    expect(output.getAttribute('aria-label')).toBe('Export a copy');
    expect([...output.querySelectorAll('.output-choice strong')].map((entry) => entry.textContent)).toEqual([
      'PNG',
      'GIF · Blink',
      'GIF · Slide',
    ]);
    expect(output.textContent).not.toContain('Save to this case');
    expect(output.textContent).toContain('Export copy');
  });

  it('adds a note over the comparison and keeps it in the editable state', async () => {
    await open();
    await add('A');
    await add('B');
    const canvas = target.querySelector('[aria-label="Annotations on imagery A"]');
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 600 });
    target.querySelector('button[title^="Note"]').click();
    flushSync();
    canvas.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, clientX: 16, clientY: 12 })
    );
    flushSync();
    const text = target.querySelector('input[aria-label="Annotation text"]');
    text.value = 'Before';
    text.dispatchEvent(new Event('input', { bubbles: true }));
    button('Apply', target).click();
    flushSync();
    expect(target.querySelector('.mark text').textContent).toContain('Before');
    expect(target.querySelector('.annotation-toolbar')).not.toBeNull();
    expect(target.querySelector('.badge').textContent).toBe('unsaved');
    button('Save comparison', target).click();
    flushSync();
    button('Save comparison', document.querySelector('[role="dialog"]')).click();
    await settle();
    expect(post).toHaveBeenCalledWith(
      '/api/cases/case-a/compare/sessions',
      expect.objectContaining({
        spec: expect.objectContaining({
          annotations: [expect.objectContaining({ kind: 'text', text: 'Before' })],
        }),
      })
    );
  });

  it('saves a reopenable session and restores sources, layers, mode and camera', async () => {
    await open();
    await add('A');
    await add('B');
    button('Save comparison', target).click();
    flushSync();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    button('Save comparison', document.querySelector('[role="dialog"]')).click();
    await settle();
    expect(post).toHaveBeenCalledWith(
      '/api/cases/case-a/compare/sessions',
      expect.objectContaining({
        rename_from: null,
        spec: expect.objectContaining({
          a: expect.objectContaining({ present: true }),
          b: expect.objectContaining({ present: true }),
        }),
      })
    );

    button('New', target).click();
    flushSync();
    expect(target.querySelectorAll('.empty-slot')).toHaveLength(2);
    button('Open', target).click();
    await settle();
    button('Harbour change', document.querySelector('[role="dialog"]')).click();
    await settle();
    expect(target.querySelector('input[aria-label="Comparison name"]').value).toBe('Harbour change');
    expect(target.querySelector('.compare-stage').classList.contains('swipe')).toBe(true);
    expect(target.querySelector('.compare-stage').style.getPropertyValue('--divider')).toBe('61%');
    expect(target.querySelectorAll('.surface-shell')).toHaveLength(2);
    expect(engines.at(-1).camera()).toEqual(expect.objectContaining({ lat: 43.3, lon: 5.4, zoom: 18 }));
  });

  it('puts the imagery a run would sweep on the maps, and shows one for one date', async () => {
    await open();
    await add('A');
    await add('B', 'Esri Wayback');
    // Outside Detect the source cards lead.
    expect(target.querySelector('.source-bar')).not.toBeNull();

    button('Detect', target).click();
    await settle();
    const dock = () => target.querySelector('.cmp-dock');
    const stage = () => target.querySelector('.compare-stage');
    expect(stage().classList.contains('solo')).toBe(false);
    // Inside it, one place to choose imagery, and the maps follow it: world
    // imagery on A and Wayback on B is no pair, so the step takes the wheel.
    expect(target.querySelector('.source-bar')).toBeNull();
    expect(dock().textContent).toContain('so they now show the one below');
    expect(target.querySelectorAll('.surface-shell .map')).toHaveLength(2);

    const picker = target.querySelector('select[aria-label="Analyzer"]');
    picker.value = 'solo';
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    // One date to read, so one map, and no reference image asked for.
    expect(stage().classList.contains('solo')).toBe(true);
    expect(dock().textContent).not.toContain('Reference A');

    button('Side by side', target).click();
    flushSync();
    expect(stage().classList.contains('solo')).toBe(false);
    expect(target.querySelector('.source-bar')).not.toBeNull();
  });

  it('discards edits back to the saved version, where New would start over', async () => {
    await open();
    button('Open', target).click();
    await settle();
    button('Harbour change', document.querySelector('[role="dialog"]')).click();
    await settle();
    expect(target.querySelector('.badge')).toBeNull();
    expect(button('Discard', target).disabled).toBe(true);

    button('Fade', target).click();
    flushSync();
    expect(target.querySelector('.badge').textContent).toBe('unsaved');
    expect(button('Discard', target).disabled).toBe(false);

    button('Discard', target).click();
    flushSync();
    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog.textContent).toContain('Harbour change');
    button('Discard changes', dialog).click();
    await settle();
    // Back to the saved swipe, with both sources still on the stage.
    expect(target.querySelector('.compare-stage').classList.contains('swipe')).toBe(true);
    expect(target.querySelectorAll('.surface-shell')).toHaveLength(2);
    expect(target.querySelector('.badge')).toBeNull();
  });
});
