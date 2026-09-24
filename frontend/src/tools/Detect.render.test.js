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
    measure: '{value}× brighter than the water around it' },
    { id: 'surface', label: 'Any reflectance change', single: false, clouds: true, sizes: {},
      measure: 'Reflectance moved by {value}%' }],
  max_tiles: 4096, max_results: 2000, grid: [13, 512],
};
const PROVIDERS = [{ id: 'esri-world-imagery', label: 'Esri World Imagery', kind: 'tiles' },
  { id: 'osm', label: 'OpenStreetMap', kind: 'tiles' }, { id: 'sentinel2', label: 'Copernicus Sentinel-2', kind: 'tiles' }];
const WATCH = 'abcdef123456';
const RUN = '123456789abc';
const PAIR_RUN = 'fedcba987654';
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
  if (path === `/api/cases/case-a/analysis/runs/${RUN}`) {
    const pass = { provider: 'sentinel2', date: '2026-09-06' };
    return { id: RUN, title: 'Anchorage sweep', status: 'ready', progress: 1, total: 1, count: 0,
      engine_version: 2, results: [], area_runs: [{ area_id: 'z1', status: 'ready', a: pass, b: pass }],
      input: { title: 'Anchorage sweep', zones: area, recipe: structuredClone(ANALYZERS.builtins[0]), note: '',
        a: pass, b: pass, offline: false, date_rule: 'manual', followup_id: null } };
  }
  if (path === `/api/cases/case-a/analysis/runs/${PAIR_RUN}`) {
    const a = { provider: 'sentinel2', date: '2026-09-08', layer: 'TRUE_COLOR', maxcc: 30 };
    const b = { ...a, date: '2026-09-21' };
    const recipe = { ...structuredClone(ANALYZERS.builtins[0]), id: 'change', method: 'surface', phenomenon: 'Surface change' };
    return { id: PAIR_RUN, title: 'Earthworks', status: 'ready', progress: 1, total: 1, count: 1, engine_version: 2,
      results: [{ id: '0-1', area_id: 'z1', coordinates: [42.95, 14.81], bbox: [42.95, 14.81, 42.951, 14.811],
        area: 900, margin: 2, strength: 'clear', measure: { signed: -8 }, review: 'new', phenomenon: 'Surface change',
        parts: [], sources: { a, b } }],
      area_runs: [{ area_id: 'z1', status: 'ready', a, b }],
      input: { title: 'Earthworks', zones: area, recipe, note: '', a, b, offline: false, date_rule: 'manual', followup_id: null } };
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
  const handlers = {};
  // A jump and a framing come to rest inside the call, as the engine's do when
  // they are not animated.
  const settle = () => handlers['view-settled']?.forEach((handler) => handler({ ...camera }));
  const engine = {
    handlers,
    on: vi.fn((name, handler) => {
      (handlers[name] ??= new Set()).add(handler);
      return () => handlers[name].delete(handler);
    }),
    camera: vi.fn(() => ({ ...camera })),
    getZoom: vi.fn(() => camera.zoom),
    maxZoom: vi.fn(() => 18),
    setView: vi.fn((next, zoom) => { camera = { ...camera, ...next, zoom }; }),
    setCamera: vi.fn((next) => {
      camera = { lat: next.lat, lon: next.lon, zoom: Math.min(next.zoom, 18), bearing: next.bearing ?? 0 };
      settle();
    }),
    setBearing: vi.fn(),
    fitBounds: vi.fn((box) => {
      camera = { ...camera, lat: (box.north + box.south) / 2, lon: (box.east + box.west) / 2 };
      settle();
    }),
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
const setAlternate = vi.fn();
const showAlternate = vi.fn();
vi.mock('../lib/map/basemap.js', () => ({
  OVERLAY_IDS: ['boundaries', 'roads', 'labels'],
  createBasemaps: vi.fn(() => ({ show: showBasemap, setOverlay, setAlternate, showAlternate,
    setZoomCeiling: vi.fn(), dispose: vi.fn() })),
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
  uiState.lookAt = null;
  uiState.gotoCoords = null;
  uiState.mapView = null;
  uiState.mapPoint = null;
  prefs.detectView = undefined;
  prefs.mapSync = false;
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
    expect(target.querySelector('.turn-guide')).toBe(null);  // a plain drag pans
    grab({ button: 1 });
    flushSync();
    expect(target.querySelector('.turn-guide')).not.toBe(null);
    // a quarter of the wheel, swept outside its circle
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 500, clientY: 300 }));
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 400, clientY: 400 }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    flushSync();
    expect(engines[0].setBearing).toHaveBeenCalled();
    expect(target.querySelector('.turn-guide')).toBe(null);
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

  const rightClick = (at) => {
    engines[0].on.mock.calls.find(([name]) => name === 'contextmenu')[1](at);
    flushSync();
    return target.querySelector('[role="menu"][aria-label="This point"]');
  };
  /** The measure canvas, once the ruler is up: the one layer taking the pointer. */
  const drawingCanvas = () => {
    const canvas = target.querySelector('.annotation-canvas.drawing');
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 });
    return canvas;
  };
  // The fake engine puts a degree of longitude on every pixel across and a degree
  // of latitude on every pixel down.
  const press = (canvas, type, x, y) => canvas.dispatchEvent(new PointerEvent(type,
    { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 1 }));

  it('opens a menu on a right-click, with the acts Detect can honour', async () => {
    await open();
    const menu = rightClick({ lat: 14.81, lon: 42.95, x: 200, y: 150 });
    expect(menu).not.toBe(null);
    for (const text of ['DD', 'What is here?', 'Measure from here', 'Centre the map here', 'Compare here…', 'Open in…']) {
      expect(menu.textContent).toContain(text);
    }
    // no sun panel, no imagery history, and no run open to add a candidate to
    for (const text of ['Sun and moon', 'Imagery history', 'Save place', 'Add candidate here']) {
      expect(menu.textContent).not.toContain(text);
    }
    button('Centre the map here').click(); flushSync();
    expect(engines[0].setView).toHaveBeenLastCalledWith({ lat: 14.81, lon: 42.95 }, 12);
    expect(target.querySelector('[role="menu"]')).toBe(null);
    // opening it asked nothing of anyone
    expect(post).not.toHaveBeenCalled();
    expect(get.mock.calls.some(([path]) => path.includes('/geo/'))).toBe(false);
  });

  it('opens the point in Satellite or Compare from the menu, at the zoom it was looked at', async () => {
    await open();
    rightClick({ lat: 14.81, lon: 42.95, x: 200, y: 150 });
    starts('Open in').click(); await settle();
    const sub = target.querySelector('[role="menu"][aria-label="Open this point in"]');
    const rows = [...sub.querySelectorAll('[role="menuitem"]')].map((row) => row.textContent.trim());
    // the other map tabs first, then the maps outside the app
    expect(rows.slice(0, 2)).toEqual(['Satellite', 'Compare']);
    expect(rows).not.toContain('Detect');
    expect(rows.length).toBeGreaterThan(3);
    button('Satellite').click(); flushSync();
    expect(uiState.tool).toBe('satellite');
    expect(uiState.gotoCoords).toEqual({ lat: 14.81, lon: 42.95, zoom: 12 });
  });

  it('looks where another map tab asked, over the case\'s landing frame', async () => {
    uiState.lookAt = { tool: 'detect', lat: 12.7615, lon: 43.6571, zoom: 15 };
    await open();
    expect(uiState.lookAt).toBe(null);
    expect(engines[0].setView).toHaveBeenLastCalledWith({ lat: 12.7615, lon: 43.6571 }, 15);
    // the areas the case watches arrived too, and did not take the camera back
    const frames = engines[0].fitBounds.mock.invocationCallOrder;
    const looked = engines[0].setView.mock.invocationCallOrder.at(-1);
    expect(frames.every((order) => order < looked)).toBe(true);
  });

  it('opens the same menu from a right-click on an area drawn over the map', async () => {
    await open();
    const outline = target.querySelector('.detect-areas polygon');
    const press = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 42.95, clientY: 14.81 });
    outline.dispatchEvent(press);
    flushSync();
    // the browser's own menu is kept away, and the point is the ground under the press
    // (the fake engine reads a container pixel as a degree)
    expect(press.defaultPrevented).toBe(true);
    const menu = target.querySelector('[role="menu"][aria-label="This point"]');
    expect(menu.textContent).toContain('42.95');
    expect(menu.textContent).toContain('14.81');
  });

  it('adds a candidate from the menu, inside an area of the run under review', async () => {
    await open();
    uiState.openAnalyzer = `runs-${RUN}`;
    flushSync();
    await settle();
    // outside the run's ground there is nothing to add it to
    expect(rightClick({ lat: 10, lon: 10, x: 10, y: 10 }).textContent).not.toContain('Add candidate here');
    const menu = rightClick({ lat: 14.81, lon: 42.95, x: 200, y: 150 });
    expect(menu.textContent).toContain('Add candidate here');
    // one pass read twice has nothing to blink
    expect(labelled('Blink A and B')).toBe(null);
    post.mockResolvedValueOnce({ id: 'manual-1', origin: 'manual', area_id: 'z1', coordinates: [42.95, 14.81],
      geometry: { type: 'Point', coordinates: [42.95, 14.81] }, bbox: [42.95, 14.81, 42.9501, 14.8101],
      area: 90, margin: 0, measure: {}, review: 'new', phenomenon: 'Manual candidate', parts: [] });
    button('Add candidate here').click();
    await settle();
    expect(post).toHaveBeenCalledWith(`/api/cases/case-a/analysis/runs/${RUN}/results`,
      { area_id: 'z1', geometry: { type: 'Point', coordinates: [42.95, 14.81] } });
    expect(target.textContent).toContain('Manual candidate · Manual');
  });

  it('hides what the detection draws, and blinks A against B in the same map', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      await open();
      uiState.openAnalyzer = `runs-${PAIR_RUN}`;
      flushSync();
      await settle();
      expect(target.querySelector('.detect-areas')).not.toBe(null);
      labelled('Hide the candidates and areas').click(); flushSync();
      expect(target.querySelector('.detect-areas')).toBe(null);
      expect(target.querySelector('.analysis-overlay')).toBe(null);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h' })); flushSync();
      expect(target.querySelector('.detect-areas')).not.toBe(null);

      labelled('Blink A and B').click(); flushSync(); await settle();
      const chip = target.querySelector('[aria-label="Blinking A and B"]');
      // B is the pass on the map; A is laid over it, loaded and transparent
      expect(chip.textContent).toContain('B');
      expect(chip.textContent).toContain('2026-09-21');
      expect(setAlternate).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 'sentinel2' }), expect.stringContaining('2026-09-08'), expect.any(Number)
      );
      expect(showBasemap).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 'sentinel2' }), expect.stringContaining('2026-09-21'), expect.any(Number)
      );
      // Compare's normal speed: A shows, then B again
      vi.advanceTimersByTime(800); flushSync();
      expect(chip.textContent).toContain('2026-09-08');
      expect(showAlternate).toHaveBeenLastCalledWith(true);
      vi.advanceTimersByTime(800); flushSync();
      expect(showAlternate).toHaveBeenLastCalledWith(false);
      labelled('Stop blinking').click(); flushSync();
      expect(labelled('Blink A and B').getAttribute('aria-pressed')).toBe('false');
      expect(setAlternate).toHaveBeenLastCalledWith(null, '', 256);
      // B, the key, starts it again from the review
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b' })); flushSync();
      expect(labelled('Blink A and B').getAttribute('aria-pressed')).toBe('true');
    } finally {
      vi.useRealTimers();
    }
  });

  it('measures a length from the ruler, and drops a selected measure with Delete', async () => {
    await open();
    const ruler = labelled('Measure');
    expect(ruler.getAttribute('aria-pressed')).toBe('false');
    ruler.click(); flushSync();
    expect(ruler.getAttribute('aria-pressed')).toBe('true');
    expect(target.textContent).toContain('Drag from one end to the other');
    const canvas = drawingCanvas();
    press(canvas, 'pointerdown', 40, 14);
    press(canvas, 'pointermove', 43, 14);
    press(canvas, 'pointerup', 43, 14);
    flushSync();
    // one measure, labelled with its length, and the ruler put down so it can be adjusted
    expect(target.querySelector('.annotation-canvas .mark text')?.textContent).toMatch(/^\d+(\.\d)? km$/);
    expect(ruler.getAttribute('aria-pressed')).toBe('false');
    expect(labelled('Clear measures')).not.toBe(null);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' })); flushSync();
    expect(target.querySelector('.annotation-canvas .mark text')).toBe(null);
    expect(labelled('Clear measures')).toBe(null);
    // M picks the ruler up, Escape puts it down
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' })); flushSync();
    expect(ruler.getAttribute('aria-pressed')).toBe('true');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); flushSync();
    expect(ruler.getAttribute('aria-pressed')).toBe('false');
  });

  it('starts a measure on the right-clicked point, finished by the next click', async () => {
    await open();
    rightClick({ lat: 14, lon: 40, x: 400, y: 140 });
    button('Measure from here').click(); await settle();
    expect(labelled('Measure').getAttribute('aria-pressed')).toBe('true');
    expect(target.textContent).toContain('Click the far end');
    press(drawingCanvas(), 'pointerdown', 42, 14);
    flushSync();
    expect(target.querySelector('.annotation-canvas .mark text')?.textContent).toMatch(/km$/);
    expect(labelled('Clear measures')).not.toBe(null);
    labelled('Clear measures').click(); flushSync();
    expect(target.querySelector('.annotation-canvas .mark text')).toBe(null);
  });
});

describe('one camera for the map tabs', () => {
  // Satellite left the window at z20, deeper than this map's imagery goes.
  const SATELLITE = { lat: 12.7615, lon: 43.6571, zoom: 20, bearing: 30, by: 'satellite' };
  const AREAS = { lat: (14.84 + 14.78) / 2, lon: (42.97 + 42.9) / 2 };

  it('writes where it comes to rest, for the other map tabs and for Coordinates', async () => {
    prefs.mapSync = true;
    await open();
    engines[0].handlers['view-settled'].forEach((handler) => handler({ lat: 15, lon: 43, zoom: 14, bearing: 12 }));
    flushSync();
    expect(uiState.mapView).toEqual({ lat: 15, lon: 43, zoom: 14, bearing: 12, by: 'detect' });
    expect(uiState.mapPoint).toEqual({ lat: 15, lon: 43, zoom: 14 });
  });

  it('takes the window camera when it shows again, never while another tab does', async () => {
    prefs.mapSync = true;
    await open();
    uiState.tool = 'satellite';
    uiState.mapView = { ...SATELLITE };
    flushSync();
    expect(engines[0].setCamera).not.toHaveBeenCalled();
    uiState.tool = 'detect';
    flushSync();
    expect(engines[0].setCamera).toHaveBeenLastCalledWith(expect.objectContaining({ ...SATELLITE }));
    // it landed at its own ceiling, which leaves Satellite's z20 standing
    expect(uiState.mapView).toMatchObject({ zoom: 20, by: 'satellite' });
    expect(uiState.mapPoint).toEqual({ lat: SATELLITE.lat, lon: SATELLITE.lon, zoom: 18 });
  });

  it('keeps a run under review where it is', async () => {
    prefs.mapSync = true;
    await open();
    uiState.openAnalyzer = `runs-${PAIR_RUN}`;
    flushSync();
    await settle();
    uiState.tool = 'satellite';
    uiState.mapView = { ...SATELLITE };
    flushSync();
    uiState.tool = 'detect';
    flushSync();
    expect(engines[0].setCamera).not.toHaveBeenCalled();
  });

  it('stays on its own ground with the preference off', async () => {
    await open();
    uiState.tool = 'satellite';
    uiState.mapView = { ...SATELLITE };
    flushSync();
    uiState.tool = 'detect';
    flushSync();
    expect(engines[0].setCamera).not.toHaveBeenCalled();
  });

  it('holds a framing asked for while another tab shows until this one does', async () => {
    await open();
    const framed = engines[0].fitBounds.mock.calls.length;
    uiState.tool = 'satellite';
    uiState.openAnalyzer = `followups-${WATCH}`;
    flushSync();
    await settle();
    // a hidden map has no size to fit the routine's ground to
    expect(engines[0].fitBounds).toHaveBeenCalledTimes(framed);
    uiState.tool = 'detect';
    flushSync();
    expect(engines[0].fitBounds).toHaveBeenCalledTimes(framed + 1);
  });

  it('arrives where Satellite was rather than on the ground the case watches', async () => {
    // First visit to the case's Detect, after a walk around Satellite.
    prefs.mapSync = true;
    uiState.mapView = { ...SATELLITE };
    await open();
    const { createMapEngine } = await import('../lib/map/engine.js');
    expect(createMapEngine).toHaveBeenCalledWith(
      expect.anything(), expect.objectContaining({ view: { lat: SATELLITE.lat, lon: SATELLITE.lon, zoom: 20 } })
    );
    expect(engines[0].fitBounds).not.toHaveBeenCalled();
    expect(engines[0].camera()).toMatchObject({ lat: SATELLITE.lat, lon: SATELLITE.lon });
    expect(uiState.mapView).toMatchObject({ by: 'satellite' });
  });

  it('still lands on the watched ground when no other map has been looked at', async () => {
    prefs.mapSync = true;
    await open();
    expect(engines[0].fitBounds).toHaveBeenCalledTimes(1);
    expect(engines[0].camera()).toMatchObject(AREAS);
    expect(uiState.mapView).toMatchObject({ ...AREAS, by: 'detect' });
  });

  it('holds a landing asked for while another tab shows until this one does', async () => {
    // Built while another tab shows, as after a case switch, and with no other
    // map looked at: the areas arrive with no map on screen to fit them to.
    prefs.mapSync = true;
    uiState.tool = 'satellite';
    await open();
    expect(engines[0].fitBounds).not.toHaveBeenCalled();
    uiState.tool = 'detect';
    flushSync();
    await settle();
    expect(engines[0].fitBounds).toHaveBeenCalledTimes(1);
    expect(engines[0].camera()).toMatchObject(AREAS);
  });
});
