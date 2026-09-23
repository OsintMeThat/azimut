// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const ANALYZERS = {
  builtins: [{
    id: 'boats', name: 'Vessels', description: 'Brighter than the water around it',
    phenomenon: 'Vessel candidate', method: 'vessels', colour: '#38bdf8', style: 'both',
    parameters: { sensitivity: 70, min_area: 250, max_area: 150000, cleanup: 0, smoothing: 0,
      merge_metres: 50, index: 'ndvi', direction: 'both', ignore_clouds: true, ignore_shadows: true,
      cloud_margin: 5 },
  }],
  custom: [],
  methods: [{ id: 'vessels', label: 'Vessels: infrared contrast over water', single: true, clouds: true,
    sizes: { medium: { min_area: 250, max_area: 150000, cleanup: 0, smoothing: 0, merge_metres: 50 } },
    measure: '{value}× brighter than the water around it' }],
  max_tiles: 4096, max_results: 2000, grid: [13, 512],
};
const PROVIDERS = [{ id: 'esri-world-imagery', label: 'Esri World Imagery', kind: 'tiles' },
  { id: 'osm', label: 'OpenStreetMap', kind: 'tiles' }, { id: 'sentinel2', label: 'Copernicus Sentinel-2', kind: 'tiles' }];
const WATCH = 'abcdef123456';
const area = [{ id: 'z1', name: 'Anchorage', kind: 'rect', points: [[42.9, 14.84], [42.97, 14.78]] }];

const get = vi.fn(async (path) => {
  if (path === '/api/compare/analyzers') return structuredClone(ANALYZERS);
  if (path === '/api/satellite/providers') return PROVIDERS;
  if (path === '/api/cases/case-a/analysis/areas') return [{ id: '111111111111', name: 'Anchorage', colour: '#123456',
    geometry: { type: 'Polygon', coordinates: [[[42.9, 14.84], [42.97, 14.84], [42.97, 14.78], [42.9, 14.78], [42.9, 14.84]]] } }];
  if (path === '/api/cases/case-a/analysis/followups') {
    return [{ id: WATCH, title: 'Hodeidah anchorage', created_at: '2026-09-01T00:00:00Z', analyzer: 'Vessels',
      method: 'vessels', colour: '#38bdf8', areas: 1, zones: area, date_rule: 'latest_previous', note: '' }];
  }
  if (path === `/api/cases/case-a/analysis/followups/${WATCH}`) {
    return { id: WATCH, title: 'Hodeidah anchorage', note: '', zones: area,
      recipe: structuredClone(ANALYZERS.builtins[0]), a: { provider: 'sentinel2', date: '2026-09-01' },
      b: { provider: 'sentinel2', date: '' }, offline: false, date_rule: 'latest_previous', followup_id: null };
  }
  if (path.startsWith('/api/cases/case-a/analysis/')) return [];
  if (path.startsWith('/api/settings')) return { usage: {}, month: '2026-09' };
  return {};
});
const post = vi.fn(async () => ({}));
const put = vi.fn(async () => ({}));
vi.mock('../lib/api.js', () => ({ api: { get, post, put, patch: vi.fn(), del: vi.fn() } }));

const toast = vi.fn();
const caseState = { current: { id: 'case-a' }, rev: 0 };
const prefs = { homeView: { lat: 14.8, lon: 42.95, zoom: 12 }, units: 'metric', coordFormat: 'dd', detectView: undefined };
const { uiState } = await import('./detect/uistate.fixture.svelte.js');
vi.mock('../lib/state.svelte.js', () => ({
  api: {},
  caseState,
  uiState,
  toast,
  ensureCase: vi.fn(async () => ({ id: 'case-a' })),
  reloadCase: vi.fn(async () => {}),
  fmtCoords: (lat, lon) => `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
  prefs,
  prefsReady: Promise.resolve(),
}));

const engines = [];
function fakeEngine(view) {
  let camera = { ...view, bearing: 0 };
  const engine = {
    on: vi.fn(() => () => {}),
    camera: vi.fn(() => ({ ...camera })),
    getZoom: vi.fn(() => camera.zoom),
    setView: vi.fn((next, zoom) => { camera = { ...camera, ...next, zoom }; }),
    setBearing: vi.fn(),
    fitBounds: vi.fn(),
    viewBounds: vi.fn(() => ({ west: 42.9, south: 14.78, east: 42.97, north: 14.84 })),
    latLngToContainerPoint: vi.fn(({ lat, lon }) => ({ x: lon * 10, y: lat * 10 })),
    containerPointToLatLng: vi.fn(({ x, y }) => ({ lat: y, lon: x })),
    resize: vi.fn(),
    panBy: vi.fn(),
    destroy: vi.fn(),
  };
  // The turn gesture reads the map's own box (lib/map/gestures.js).
  const container = document.createElement('div');
  container.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 });
  engine.container = container;
  engines.push(engine);
  return engine;
}
vi.mock('../lib/map/engine.js', () => ({
  createMapEngine: vi.fn(async (element, { view }) => fakeEngine(view)),
}));
const showBasemap = vi.fn();
const setOverlay = vi.fn();
vi.mock('../lib/map/basemap.js', () => ({
  OVERLAY_IDS: ['boundaries', 'roads', 'labels'],
  createBasemaps: vi.fn(() => ({ show: showBasemap, setOverlay, setZoomCeiling: vi.fn(), dispose: vi.fn() })),
}));

const { default: Detect } = await import('./Detect.svelte');

let live, target;
const settle = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); flushSync(); };
const button = (text) => [...target.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
const starts = (text) => [...target.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(text));
const labelled = (label) => target.querySelector(`button[aria-label="${label}"]`);

async function open() {
  target = document.createElement('div');
  document.body.append(target);
  live = mount(Detect, { target });
  flushSync();
  await settle();
}

beforeEach(() => {
  vi.clearAllMocks();
  engines.length = 0;
  uiState.tool = 'detect';
  uiState.openAnalyzer = null;
  prefs.detectView = undefined;
});
afterEach(() => {
  if (live) unmount(live);
  live = null;
  target?.remove();
  document.body.innerHTML = '';
});

describe('Detect', () => {
  it('opens one map and the case list beside it, fetching no imagery of its own', async () => {
    await open();
    expect(target.querySelectorAll('.map')).toHaveLength(1);
    expect(target.querySelector('.cmp-dock').getAttribute('aria-label')).toBe('Detect');
    expect(target.textContent).toContain('Hodeidah anchorage');
    // the list is local state; nothing was posted and no run was started
    expect(post).not.toHaveBeenCalled();
  });

  it('draws the shared areas in their colour and opens Areas when pressed', async () => {
    await open();
    const outlines = target.querySelectorAll('.detect-areas polygon:not(.hit)');
    expect(outlines).toHaveLength(1);
    target.querySelector('.detect-areas g.area').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(outlines[0].getAttribute('stroke')).toBe('#123456');
    labelled('Edit Anchorage').click(); await settle();
    expect(target.querySelector('[aria-label="Rename Anchorage"]')).not.toBe(null);
    starts('Anchorage').click(); await settle();
    expect(engines[0].fitBounds).toHaveBeenCalledWith(
      expect.objectContaining({ west: 42.9, east: 42.97 }), expect.anything()
    );
  });

  it('shows which way is up, and lands framed on the ground this case watches', async () => {
    await open();
    // The surface's own chrome is off here, so Detect carries the compass itself.
    expect(target.querySelector('[aria-label="Reset to north"]')).not.toBe(null);
    // One framing, on the areas of the case, rather than the unrelated home view.
    expect(engines[0].fitBounds).toHaveBeenCalledTimes(1);
    expect(engines[0].fitBounds).toHaveBeenCalledWith(
      { west: 42.9, east: 42.97, south: 14.78, north: 14.84 }, expect.anything()
    );
  });

  it('turns the map from a shift- or middle-drag, like every other map in the app', async () => {
    await open();
    const surface = target.querySelector('.map');
    const grab = (extra) => surface.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, clientX: 400, clientY: 300, ...extra })
    );
    grab({ button: 0 });
    flushSync();
    expect(target.querySelector('.rotate-pivot')).toBe(null);  // a plain drag pans
    grab({ button: 1 });
    flushSync();
    expect(target.querySelector('.rotate-pivot')).not.toBe(null);
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 500, clientY: 200 }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    flushSync();
    expect(engines[0].setBearing).toHaveBeenCalled();
    expect(target.querySelector('.rotate-pivot')).toBe(null);
  });

  it('keeps the drawn areas in the map\'s own layer list', async () => {
    await open();
    starts('Layers').click(); await settle();
    const row = target.querySelector('[aria-label="Watched areas"]');
    expect(row.getAttribute('aria-pressed')).toBe('true');
    row.click(); await settle();
    expect(target.querySelectorAll('.detect-areas polygon:not(.hit)')).toHaveLength(0);
  });

  it('opens on Esri with Borders and saved work, with the search over the map and no header strip', async () => {
    await open();
    expect(target.querySelector('.bar')).toBe(null);
    expect(target.querySelector('.surface-shell .search.cmp-glass')).not.toBe(null);
    expect(showBasemap).toHaveBeenCalledWith(expect.objectContaining({ id: 'esri-world-imagery' }), 'esri-world-imagery', expect.anything());
    expect(setOverlay).toHaveBeenCalledWith('boundaries', true, null);
    starts('Layers').click(); await settle();
    expect(target.querySelector('[aria-label="Saved work"]').getAttribute('aria-pressed')).toBe('true');
    expect(get.mock.calls.some(([path]) => path.includes('/sentinel/'))).toBe(false);
    expect(post).not.toHaveBeenCalled();
  });

  it('collapses to a remembered rail, resizes the map and reopens from a tab or shortcut', async () => {
    await open();
    engines[0].resize.mockClear();
    target.querySelector('[aria-label="Collapse Detect panel"]').click(); await settle();
    expect(target.querySelector('.dock-tabs.rail')).not.toBe(null);
    expect(engines[0].resize).toHaveBeenCalled();
    expect(put).toHaveBeenLastCalledWith('/api/settings/prefs', { detect_view: expect.objectContaining({ collapsed: true }) });
    target.querySelector('[aria-label="Saved"]').click(); await settle();
    expect(target.querySelector('.dock-tabs.rail')).toBe(null);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ']' })); await settle();
    expect(target.querySelector('.dock-tabs.rail')).not.toBe(null);
    await unmount(live); live = null; target.remove();
    await open();
    expect(target.querySelector('.dock-tabs.rail')).not.toBe(null);
  });

  it('restores the Detect basemap and overlays without requesting a pass', async () => {
    prefs.detectView = { collapsed: false, basemap: 'osm', overlays: ['roads'], saved: false };
    await open();
    expect(showBasemap).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'osm' }), 'osm', expect.anything());
    expect(setOverlay).toHaveBeenCalledWith('roads', true, null);
    expect(setOverlay).toHaveBeenCalledWith('boundaries', false, undefined);
    expect(post).not.toHaveBeenCalled();
  });

  it('takes the current view as an area to sweep', async () => {
    await open();
    button('New detection').click(); await settle();
    starts('One pass').click(); await settle();
    expect(target.textContent).toContain('Draw an area to look in.');
    button('Use current view').click(); await settle();
    expect(target.querySelector('[aria-label="Area name"]').value).toBe('Area 1');
    expect(target.textContent).toContain('tile');
  });

  it('opens a saved item the rest of the app asked for', async () => {
    await open();
    uiState.openAnalyzer = `followups-${WATCH}`;
    flushSync();
    await settle();
    expect(uiState.openAnalyzer).toBe(null);
    expect(get).toHaveBeenCalledWith(`/api/cases/case-a/analysis/followups/${WATCH}`);
  });
});
