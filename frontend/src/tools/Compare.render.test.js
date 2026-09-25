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
    frame: { points: [[5.35, 43.25], [5.45, 43.35]] },
    annotations: [
      { id: 'before', kind: 'text', colour: '#f6a81a', points: [[5.4, 43.3]], text: 'Before' },
    ],
    a: { present: true, provider: 'esri-world-imagery', overlays: ['roads'] },
    b: { present: true, provider: 'esri-wayback', overlays: ['railway'] },
  },
};

const SIZES = {
  small: { min_area: 0, max_area: 0, cleanup: 0, smoothing: 0, merge_metres: 0 },
  medium: { min_area: 2000, max_area: 0, cleanup: 1, smoothing: 0, merge_metres: 30 },
  large: { min_area: 20000, max_area: 0, cleanup: 1, smoothing: 1, merge_metres: 100 },
};
const RECIPE = {
  id: 'pair', name: 'Any surface change', description: 'Reflectance that moved',
  phenomenon: 'Change', method: 'surface', colour: '#f6a81a', style: 'both',
  parameters: { sensitivity: 67, ...SIZES.medium, index: 'ndvi', direction: 'both',
    ignore_clouds: true, ignore_shadows: true, cloud_margin: 5 },
};
const ANALYZERS = {
  builtins: [RECIPE, { ...RECIPE, id: 'solo', name: 'Vessels', method: 'vessels' }],
  custom: [],
  methods: [
    { id: 'surface', label: 'Any reflectance change', single: false, clouds: true, sizes: SIZES,
      measure: 'Reflectance moved by {value}%' },
    { id: 'vessels', label: 'Vessels', single: true, clouds: true, sizes: SIZES,
      measure: '{value}× brighter than the water around it' },
  ],
  max_tiles: 4096, max_results: 2000, grid: [13, 512],
};

// Newest first. Empty by default, so the opening pair has no "then" to show.
let releases = [];
// The releases that first published a picture of the point, newest first; the
// release list stands in when a test sets none.
let changes = null;
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
  if (path === '/api/satellite/wayback/releases') return { releases: structuredClone(releases) };
  if (path.startsWith('/api/satellite/wayback/changes')) return { changes: structuredClone(changes ?? releases) };
  if (path === '/api/cases/case-a/compare/sessions') {
    return [
      { name: 'Harbour change', title: 'Harbour change', provider_a: 'esri-world-imagery', provider_b: 'esri-wayback', mode: 'swipe' },
      { name: 'Old difference', title: 'Old difference', provider_a: 'esri-world-imagery', provider_b: 'esri-wayback', mode: 'change' },
    ];
  }
  if (path === '/api/cases/case-a/compare/sessions/Harbour%20change') return SESSION;
  // Saved while Difference was a mode of its own, over one image.
  if (path === '/api/cases/case-a/compare/sessions/Old%20difference') {
    return {
      ...SESSION,
      title: 'Old difference',
      spec: { ...SESSION.spec, mode: 'change', frame: null, change_assist: { base: 'side' } },
    };
  }
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
// Reactive, so a tab switch wakes the effects that watch it.
const { uiState } = await import('./detect/uistate.fixture.svelte.js');
const prefs = { homeView: { lat: 48.8566, lon: 2.3522, zoom: 16 }, units: 'metric', mapSync: false };
vi.mock('../lib/state.svelte.js', () => ({
  caseState,
  ensureCase,
  fmtCoords: (lat, lon) => `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
  prefs,
  prefsReady: Promise.resolve(),
  reloadCase,
  toast,
  uiState,
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
    viewBounds: vi.fn(() => ({ west: camera.lon - 0.001, south: camera.lat - 0.001,
      east: camera.lon + 0.001, north: camera.lat + 0.001 })),
    container,
    setBearing: vi.fn((bearing) => (camera.bearing = bearing)),
    setView: vi.fn((view, zoom) => (camera = { ...camera, ...view, zoom })),
    setCamera: vi.fn((next) => (camera = { lat: next.lat, lon: next.lon, zoom: next.zoom, bearing: next.bearing ?? 0 })),
    maxZoom: vi.fn(() => 19),
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

// An evolution's pictures come from the tile proxy; here each one is a stand-in
// canvas, so the dialog's choices and the request it posts can be read.
const pictureCanvas = () => ({ width: 400, height: 300, toBlob: (done) => done(new Blob(['png'])) });
const drawPictures = vi.fn(async ({ entries, variantFor, onpicture, onprogress }) => {
  for (const [index, entry] of entries.entries()) {
    onprogress?.(index, entries.length);
    variantFor(entry);
    await onpicture({ entry, index, picture: { canvas: pictureCanvas(), frame: {} } });
  }
  return { drawn: entries.length, empty: 0, repeated: 0 };
});
const composeEvolutionFrame = vi.fn(() => pictureCanvas());
const composeEvolutionSheet = vi.fn(() => pictureCanvas());
vi.mock('../lib/map/evolutionExport.js', () => ({ drawPictures, composeEvolutionFrame, composeEvolutionSheet }));

const { default: Compare } = await import('./Compare.svelte');

let live;
let target;

async function settle() {
  for (let index = 0; index < 60; index += 1) await Promise.resolve();
  flushSync();
}

/** Mount Compare on its opening pair. */
async function openFresh() {
  target = document.createElement('div');
  document.body.append(target);
  live = mount(Compare, { target });
  flushSync();
  await settle();
}

/** …then clear both sides, for a test that builds its own pair. */
async function open() {
  await openFresh();
  for (const letter of ['A', 'B']) {
    target.querySelector(`button[aria-label="Remove imagery ${letter}"]`)?.click();
    flushSync();
  }
  await settle();
  engines.length = 0;
}

function button(label, root = document) {
  return [...root.querySelectorAll('button')].find((entry) => entry.textContent.trim().includes(label));
}

/** Start over from the New menu, on one of its presets. */
async function startNew(label = 'Then and now') {
  button('New', target).click();
  flushSync();
  button(label, target.querySelector('.new-menu')).click();
  flushSync();
  await settle();
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
  releases = [];
  changes = null;
  uiState.tool = 'compare';
  uiState.openCompare = null;
  uiState.compareAt = null;
  uiState.lookAt = null;
  uiState.mapView = null;
  uiState.mapPoint = null;
  prefs.mapSync = false;
});

afterEach(() => {
  if (live) unmount(live);
  live = null;
  target?.remove();
  target = null;
  document.body.innerHTML = '';
});

describe('Compare', () => {
  it('opens on a Wayback release a year back against today’s World Imagery', async () => {
    releases = [
      { release: 30, date: '2026-09-01' },
      { release: 20, date: '2025-06-01' },
      { release: 10, date: '2014-02-20' },
    ];
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-23T12:00:00Z'));
    try {
      await openFresh();
    } finally {
      vi.useRealTimers();
    }
    expect(target.querySelector('h2').textContent).toBe('Compare');
    expect(target.querySelectorAll('.empty-slot')).toHaveLength(0);
    expect(target.querySelectorAll('.surface-shell')).toHaveLength(2);
    expect(target.querySelectorAll('.presets')).toHaveLength(0);
    const saved = () => post.mock.calls.find(([path]) => path === '/api/cases/case-a/compare/sessions')?.[1];
    button('Save comparison', target).click();
    flushSync();
    button('Save comparison', document.querySelector('[role="dialog"]')).click();
    await settle();
    expect(saved().spec.a).toMatchObject({ present: true, provider: 'esri-wayback', wayback_release: 20 });
    expect(saved().spec.b).toMatchObject({ present: true, provider: 'esri-world-imagery' });
    // local-first: the pair costs the release list, never a point's history
    expect(get.mock.calls.some(([path]) => path.includes('/wayback/changes'))).toBe(false);
  });

  it('leaves the then side empty rather than showing today twice', async () => {
    // no release list: a Wayback A would be World Imagery again
    await openFresh();
    expect(target.querySelectorAll('.surface-shell')).toHaveLength(1);
    expect(target.querySelector('.surface-label strong').textContent).toBe('B');
    expect(target.querySelectorAll('.empty-slot')).toHaveLength(1);
  });

  it('asks nothing when an untouched pair is left, however it was panned', async () => {
    releases = [{ release: 30, date: '2026-09-01' }, { release: 10, date: '2014-02-20' }];
    await openFresh();
    engines[0].handlers['view-settled']?.({ lat: 40, lon: 3, zoom: 12 });
    flushSync();
    expect(target.querySelector('.badge')).toBeNull();
    expect(button('Discard', target).disabled).toBe(true);
    // …while Save still takes it, a pair at a place being worth keeping
    expect(button('Save comparison', target).disabled).toBe(false);
    await startNew();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
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
    ]);
    // The second surface opens on the first camera without needing a corrective move.
    expect(engines[1].camera()).toEqual(engines[0].camera());
    expect(target.querySelectorAll('.source-card')).toHaveLength(2);
    expect(target.querySelectorAll('.source-card button[aria-label="Imagery provider"]')).toHaveLength(2);
    expect(
      target.querySelector('.compare-bar').compareDocumentPosition(target.querySelector('.source-bar')) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    // The cards are as wide as the maps they describe, so the seam between A and
    // B is one line: the annotation rail beside the stage narrows both together.
    const column = target.querySelector('.stage-column');
    expect(target.querySelector('.source-bar').parentElement).toBe(column);
    expect(target.querySelector('.compare-stage').parentElement).toBe(column);
    expect(target.querySelector('.annotation-toolbar').parentElement).toBe(column.parentElement);
    // One camera, so one compass in the bar and none on either surface.
    expect(target.querySelectorAll('button[aria-label="Reset to north"]')).toHaveLength(1);
    expect(target.querySelector('.surface-shell button[aria-label="Reset to north"]')).toBeNull();
    // local-first: Wayback names its releases once it is on screen, but nothing
    // walks this point's history until the analyst asks for the changes
    expect(get).toHaveBeenCalledWith('/api/satellite/wayback/releases');
    expect(get.mock.calls.some(([path]) => path.includes('/wayback/changes'))).toBe(false);
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
    expect(divider.querySelectorAll('.swipe-handle svg')).toHaveLength(2);
    expect(divider.textContent).not.toContain('↔');
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

  it('offers Difference only on a pair it can read', async () => {
    await open();
    await add('A');
    await add('B');
    // The same picture twice: nothing a pixel reading could say about it.
    expect(button('Difference', target)).toBeUndefined();
    expect(target.querySelector('.difference-bar')).toBeNull();
  });

  it('lays the difference over the view that is on, without a panel of its own', async () => {
    await open();
    await add('A');
    await add('B', 'Esri Wayback');
    button('Swipe', target).click();
    flushSync();
    button('Difference', target).click();
    flushSync();
    await settle();

    const stage = () => target.querySelector('.compare-stage');
    // The view stays what it was, and the maps keep the whole width.
    expect(stage().classList.contains('swipe')).toBe(true);
    expect(button('Swipe', target).getAttribute('aria-pressed')).toBe('true');
    expect(button('Difference', target).getAttribute('aria-pressed')).toBe('true');
    expect(target.querySelector('.cmp-dock')).toBeNull();
    // Its controls sit in the footer beside the view's own.
    const footer = target.querySelector('.mode-footer');
    expect(footer.querySelector('input[aria-label="Swipe position"]')).not.toBeNull();
    expect(footer.querySelector('.difference-bar')).not.toBeNull();
    expect(target.querySelector('.change-legend')).not.toBeNull();
    // Over both images unless asked otherwise.
    const base = (label) => [...target.querySelectorAll('[aria-label="Image under the highlights"] button')]
      .find((entry) => entry.textContent.trim() === label);
    expect(base('Both').getAttribute('aria-pressed')).toBe('true');

    // Another view keeps the difference on over it.
    button('Blink', target).click();
    flushSync();
    expect(stage().classList.contains('overlay')).toBe(true);
    expect(target.querySelector('.difference-bar')).not.toBeNull();

    button('Difference', target).click();
    flushSync();
    expect(target.querySelector('.difference-bar')).toBeNull();
    expect(target.querySelector('.change-legend')).toBeNull();
    expect(button('Blink', target).getAttribute('aria-pressed')).toBe('true');
  });

  it('shows the difference side by side with no footer of the view to share', async () => {
    await open();
    await add('A');
    await add('B', 'Esri Wayback');
    expect(target.querySelector('.mode-footer')).toBeNull();
    button('Difference', target).click();
    flushSync();
    await settle();
    expect(target.querySelector('.compare-stage').classList.contains('overlay')).toBe(false);
    expect(target.querySelector('.mode-footer .difference-bar')).not.toBeNull();
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
    await startNew();

    const warning = document.querySelector('[role="alertdialog"]');
    expect(warning.textContent).toContain('Discard unsaved changes?');
    button('Cancel', warning).click();
    flushSync();
    expect(target.querySelectorAll('.surface-shell')).toHaveLength(1);

    await startNew();
    button('Discard changes', document.querySelector('[role="alertdialog"]')).click();
    await settle();
    // back on the opening pair, which without a release list is B alone
    expect(target.querySelectorAll('.surface-shell')).toHaveLength(1);
    expect(target.querySelector('.surface-label strong').textContent).toBe('B');
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
    expect(layers.querySelectorAll('.layer-row')).toHaveLength(18);
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
      'GIF · Evolution',
      'PNG · Evolution sheet',
    ]);
    // World Imagery on both sides has no history to play.
    expect([...output.querySelectorAll('input[value="evolution"], input[value="sheet"]')]
      .map((input) => input.disabled)).toEqual([true, true]);
    expect(output.textContent).toContain('Needs Sentinel-2 or Wayback on both sides');
    const sign = [...output.querySelectorAll('.keep-choice')].find((entry) => entry.textContent.includes('Sign it Azimut'));
    expect(sign.querySelector('input').checked).toBe(true);
    expect(output.textContent).not.toContain('Save to this case');
    expect(output.textContent).toContain('Export copy');
  });

  async function openThenAndNow() {
    releases = [
      { release: 30, date: '2026-09-01' },
      { release: 20, date: '2025-06-01' },
      { release: 10, date: '2014-02-20' },
    ];
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-23T12:00:00Z'));
    try {
      await openFresh();
    } finally {
      vi.useRealTimers();
    }
    button('Export', target).click();
    await settle();
    return document.querySelector('[role="dialog"]');
  }

  it('plays the Wayback pictures from A to B as one GIF, each shown as it will play', async () => {
    // A shows the 2025 release, which republished the 2020 picture; the newest
    // release carries an older one than 2020's, so the GIF plays it first.
    changes = [
      { release: 30, date: '2026-09-01', acquired: '2018-05-05' },
      { release: 15, date: '2020-01-01', acquired: '2019-03-02' },
      { release: 5, date: '2010-01-01' },
    ];
    const dialog = await openThenAndNow();
    // The export dialog alone reads nothing of the point's history.
    expect(get.mock.calls.some(([path]) => path.includes('/wayback/changes'))).toBe(false);
    const choice = dialog.querySelector('input[value="evolution"]');
    expect(choice.disabled).toBe(false);
    choice.click();
    await settle();
    expect(get.mock.calls.filter(([path]) => path.includes('/wayback/changes'))).toHaveLength(1);
    expect(dialog.textContent).toContain('An evolution is written out only');
    expect(dialog.textContent).not.toContain('Also keep it in this case');
    const rows = [...dialog.querySelectorAll('.cards li')];
    expect(rows.map((row) => row.querySelector('.mono').textContent)).toEqual([
      'Release 2010-01-01', '~2018-05-05', '~2019-03-02',
    ]);
    expect(rows.map((row) => row.querySelector('small')?.textContent ?? '')).toEqual([
      '', 'release 2026-09-01', 'release 2020-01-01',
    ]);
    // A to B: the 2020 picture A shows and the newest B shows, not the 2010 one.
    expect(rows.map((row) => row.querySelector('input').checked)).toEqual([false, true, true]);
    expect(rows.map((row) => [...row.querySelectorAll('.tag')].map((tag) => tag.textContent).join(''))).toEqual(['', 'B', 'A']);
    // Each row shows its picture, drawn from its own release.
    expect(rows[0].querySelector('.thumb img').getAttribute('src')).toMatch(/^\/api\/tiles\/esri-wayback~5\//);
    button('All', dialog.querySelector('.presets')).click();
    flushSync();
    expect(dialog.textContent).toContain('3 chosen');
    button('A to B', dialog.querySelector('.presets')).click();
    flushSync();
    expect(dialog.textContent).toContain('2 chosen');

    button('Export copy', dialog).click();
    await settle();
    const asked = drawPictures.mock.calls[0][0];
    expect(asked.entries.map((entry) => entry.release)).toEqual([30, 15]);
    expect(asked.variantFor(asked.entries[0])).toBe('esri-wayback~30');
    expect(composeEvolutionFrame.mock.calls.map(([input]) => [input.date, input.current, input.signed])).toEqual([
      ['~2018-05-05', 0, true], ['~2019-03-02', 1, true],
    ]);
    const [, form] = post.mock.calls.find(([path]) => path === '/api/cases/case-a/compare/sequence');
    expect(form.getAll('frames')).toHaveLength(2);
    expect(form.get('interval')).toBe('800');
    expect(form.get('filename')).toContain('2018-05-05_2019-03-02');
    expect(form.get('keep').split(',')).toEqual(expect.arrayContaining(['#e8a33d', '#e3e3e3']));
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('written to'), 'ok', expect.any(Number), expect.any(Object));
  });

  it('lays an evolution out as one sheet, unsigned when asked', async () => {
    const dialog = await openThenAndNow();
    dialog.querySelector('input[value="sheet"]').click();
    await settle();
    button('All', dialog.querySelector('.presets')).click();
    flushSync();
    const sign = [...dialog.querySelectorAll('.keep-choice')].find((entry) => entry.textContent.includes('Sign it Azimut'));
    sign.querySelector('input').click();
    flushSync();
    button('Export copy', dialog).click();
    await settle();
    const [input] = composeEvolutionSheet.mock.calls[0];
    expect(input.cells.map((cell) => cell.date)).toEqual(['Release 2014-02-20', 'Release 2025-06-01', 'Release 2026-09-01']);
    expect(input.signed).toBe(false);
    expect(input.span).toBe('2014-02-20 to 2026-09-01');
    const [, body] = post.mock.calls.find(([path]) => path === '/api/cases/case-a/plates');
    expect(body).toMatchObject({ format: 'png', overwrite: false });
    expect(body.filename).toMatch(/2014-02-20_2026-09-01 evolution$/);
  });

  it('frames an export on the ground and keeps the frame with the comparison', async () => {
    await open();
    await add('A');
    await add('B');

    button('Export', target).click();
    await settle();
    expect(document.querySelector('[role="dialog"]').textContent).toContain('Full view');

    button('Draw', document.querySelector('[role="dialog"]')).click();
    flushSync();
    // The stage has to be reachable while the frame is drawn, so the modal goes.
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    const overlay = target.querySelector('.export-frame.drawing');
    overlay.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 600 });
    for (const [type, x, y] of [['pointerdown', 10, 5], ['pointermove', 410, 365], ['pointerup', 410, 365]]) {
      overlay.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
      flushSync();
    }

    // Back in the export, stated as ground rather than pixels.
    const output = document.querySelector('[role="dialog"]');
    expect(output.getAttribute('aria-label')).toBe('Export a copy');
    expect(output.textContent).not.toContain('Full view');
    expect([...output.querySelectorAll('.destination-actions button')].map((entry) => entry.textContent.trim()))
      .toEqual(['Redraw…', 'Clear']);
    expect(target.querySelectorAll('.export-frame')).toHaveLength(2);
    expect(target.querySelectorAll('.export-frame.readonly')).toHaveLength(1);

    output.querySelector('button[aria-label="Close"]').click();
    button('Save comparison', target).click();
    flushSync();
    button('Save comparison', document.querySelector('[role="dialog"]')).click();
    await settle();
    expect(post).toHaveBeenCalledWith(
      '/api/cases/case-a/compare/sessions',
      expect.objectContaining({
        spec: expect.objectContaining({ frame: { points: [[10, 5], [410, 365]], angle: 0 } }),
      })
    );
    await startNew();
    expect(target.querySelector('.export-frame')).toBeNull();
  });

  it.each(['Swipe', 'Fade', 'Blink'])(
    'draws one export frame across the complete %s stage',
    async (label) => {
      await open();
      await add('A');
      await add('B');
      button(label, target).click();
      flushSync();

      button('Export', target).click();
      await settle();
      button('Draw', document.querySelector('[role="dialog"]')).click();
      flushSync();

      const overlay = target.querySelector('.export-frame.drawing');
      expect(overlay.parentElement).toBe(target.querySelector('.compare-stage'));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      flushSync();
      expect(document.querySelector('[role="dialog"]').getAttribute('aria-label')).toBe('Export a copy');
    }
  );

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

  it('acts on the right-clicked point, offering only what Compare can honour', async () => {
    await open();
    await add('A');
    await add('B');
    engines[0].handlers.contextmenu({ lat: 43.3, lon: 5.4, x: 120, y: 90 });
    flushSync();

    const menu = target.querySelector('[role="menu"]');
    expect(menu.textContent).toContain('What is here?');
    expect(menu.textContent).toContain('Save place here…');
    expect(menu.textContent).toContain('Measure from here');
    expect(menu.textContent).not.toContain('Sun and moon from here');
    expect(menu.textContent).not.toContain('Imagery history here');
    // It belongs to the surface it opened on, and travels with it.
    expect(target.querySelector('.surface-shell.primary [role="menu"]')).not.toBeNull();

    button('Measure from here', menu).click();
    await settle();
    expect(target.querySelector('[role="menu"]')).toBeNull();
    expect(target.querySelector('button[title^="Measure"]').getAttribute('aria-pressed')).toBe('true');

    // The first end is the point that was clicked; the next click takes the other.
    const canvas = target.querySelector('[aria-label="Annotations on imagery A"]');
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 600 });
    canvas.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 200, clientY: 90 }));
    canvas.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 200, clientY: 90 }));
    flushSync();
    const drawn = [...target.querySelectorAll('.surface-shell.primary .mark path')];
    expect(drawn.some((path) => path.getAttribute('stroke-dasharray') === '8 6')).toBe(true);
  });

  it('opens the right-clicked point in Satellite or Detect, at the zoom it was read at', async () => {
    await open();
    await add('A');
    await add('B');
    engines[0].handlers.contextmenu({ lat: 43.3, lon: 5.4, x: 120, y: 90 });
    flushSync();
    button('Open in', target.querySelector('[role="menu"]')).click();
    await settle();
    const sub = target.querySelector('[role="menu"][aria-label="Open this point in"]');
    const rows = [...sub.querySelectorAll('[role="menuitem"]')].map((row) => row.textContent.trim());
    expect(rows.slice(0, 2)).toEqual(['Satellite', 'Detect']);
    expect(rows).not.toContain('Compare');
    button('Detect', sub).click();
    flushSync();
    expect(uiState.tool).toBe('detect');
    expect(uiState.lookAt).toEqual({ tool: 'detect', lat: 43.3, lon: 5.4, zoom: 16 });
  });

  it('moves both maps to a point another tab asked about, and keeps its pictures', async () => {
    releases = [{ release: 30, date: '2026-09-01' }, { release: 20, date: '2025-06-01' }];
    uiState.lookAt = { tool: 'compare', lat: 12.76, lon: 43.65, zoom: 15 };
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-23T12:00:00Z'));
    try {
      await openFresh();
    } finally {
      vi.useRealTimers();
    }
    expect(uiState.lookAt).toBe(null);
    expect(engines).toHaveLength(2);
    for (const engine of engines) {
      expect(engine.camera()).toMatchObject({ lat: 12.76, lon: 43.65, zoom: 15 });
    }
    // the opening pair was still built: the point moved the camera, not the pictures
    expect(target.querySelectorAll('.empty-slot')).toHaveLength(0);
  });

  it('saves a place on the right-clicked point without leaving the comparison', async () => {
    await open();
    await add('A');
    await add('B');
    engines[1].handlers.contextmenu({ lat: 43.3, lon: 5.4, x: 40, y: 40 });
    flushSync();
    expect(target.querySelector('.surface-shell.secondary [role="menu"]')).not.toBeNull();

    button('Save place here…', target.querySelector('[role="menu"]')).click();
    await settle();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog.textContent).toContain('Save place');
    dialog.querySelector('#place-title').value = 'New quay';
    dialog.querySelector('#place-title').dispatchEvent(new Event('input', { bubbles: true }));
    button('Save', dialog).click();
    await settle();
    expect(post).toHaveBeenCalledWith(
      '/api/cases/case-a/satellite/place',
      expect.objectContaining({ lat: 43.3, lon: 5.4, title: 'New quay' })
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

    await startNew();
    expect(target.querySelector('input[aria-label="Comparison name"]').value).toBe('Comparison');
    button('Open', target).click();
    await settle();
    button('Harbour change', document.querySelector('[role="dialog"]')).click();
    await settle();
    expect(target.querySelector('input[aria-label="Comparison name"]').value).toBe('Harbour change');
    expect(target.querySelector('.compare-stage').classList.contains('swipe')).toBe(true);
    expect(target.querySelector('.compare-stage').style.getPropertyValue('--divider')).toBe('61%');
    expect(target.querySelector('.compare-stage > .export-frame')).not.toBeNull();
    expect(target.querySelectorAll('.surface-shell')).toHaveLength(2);
    expect(engines.at(-1).camera()).toEqual(expect.objectContaining({ lat: 43.3, lon: 5.4, zoom: 18 }));
  });

  it('saves Difference as a switch beside the view', async () => {
    await open();
    await add('A');
    await add('B', 'Esri Wayback');
    button('Fade', target).click();
    button('Difference', target).click();
    flushSync();
    await settle();
    button('Save comparison', target).click();
    flushSync();
    button('Save comparison', document.querySelector('[role="dialog"]')).click();
    await settle();
    const saved = post.mock.calls.find(([path]) => path === '/api/cases/case-a/compare/sessions')[1].spec;
    expect(saved).toMatchObject({ mode: 'opacity', difference: true, change_assist: { base: 'both' } });

  });

  it('reads a comparison saved with the old Difference mode as side by side with Difference on', async () => {
    await open();
    button('Open', target).click();
    await settle();
    button('Old difference', document.querySelector('[role="dialog"]')).click();
    await settle();
    expect(target.querySelector('.compare-stage').classList.contains('overlay')).toBe(false);
    expect(button('Side by side', target).getAttribute('aria-pressed')).toBe('true');
    expect(button('Difference', target).getAttribute('aria-pressed')).toBe('true');
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

describe('one camera for the map tabs', () => {
  const SATELLITE = { lat: 12.7615, lon: 43.6571, zoom: 17, bearing: 30, by: 'satellite' };

  /** The opening pair, both sides built: today's imagery against a year back. */
  async function openPairOfMaps() {
    releases = [{ release: 30, date: '2026-09-01' }, { release: 20, date: '2025-06-01' }];
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-23T12:00:00Z'));
    try {
      await openFresh();
    } finally {
      vi.useRealTimers();
    }
  }

  it('opens both maps where the other map tabs left the window', async () => {
    prefs.mapSync = true;
    uiState.mapView = { ...SATELLITE };
    await openPairOfMaps();
    expect(engines).toHaveLength(2);
    for (const engine of engines) {
      expect(engine.camera()).toMatchObject({ lat: SATELLITE.lat, lon: SATELLITE.lon, zoom: 17 });
    }
  });

  it('writes where it comes to rest, for the other map tabs and for Coordinates', async () => {
    prefs.mapSync = true;
    await openPairOfMaps();
    engines[0].handlers['view-settled']({ lat: 43.3, lon: 5.4, zoom: 15, bearing: 12 });
    flushSync();
    expect(uiState.mapView).toEqual({ lat: 43.3, lon: 5.4, zoom: 15, bearing: 12, by: 'compare' });
    expect(uiState.mapPoint).toEqual({ lat: 43.3, lon: 5.4, zoom: 15 });
  });

  it('takes the window camera in one jump when it shows again', async () => {
    prefs.mapSync = true;
    await openPairOfMaps();
    uiState.tool = 'satellite';
    uiState.mapView = { ...SATELLITE };
    flushSync();
    expect(engines[0].setCamera).not.toHaveBeenCalled();
    uiState.tool = 'compare';
    flushSync();
    // one map takes it; the camera link brings the other along
    const took = engines.filter((engine) => engine.setCamera.mock.calls.length);
    expect(took).toHaveLength(1);
    expect(took[0].setCamera).toHaveBeenCalledWith(expect.objectContaining({ ...SATELLITE }));
  });

  it('keeps a saved comparison on the ground it was saved on', async () => {
    prefs.mapSync = true;
    await open();
    button('Open', target).click();
    await settle();
    button('Harbour change', document.querySelector('[role="dialog"]')).click();
    await settle();
    uiState.tool = 'satellite';
    uiState.mapView = { ...SATELLITE };
    flushSync();
    uiState.tool = 'compare';
    flushSync();
    for (const engine of engines) expect(engine.setCamera).not.toHaveBeenCalled();
    expect(target.querySelector('.badge')).toBeNull();
  });
});
