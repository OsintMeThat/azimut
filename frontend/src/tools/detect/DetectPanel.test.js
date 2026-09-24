// @vitest-environment happy-dom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const sizes = {
  small: { min_area: 300, max_area: 0, cleanup: 0, smoothing: 0, merge_metres: 0 },
  medium: { min_area: 2000, max_area: 0, cleanup: 1, smoothing: 0, merge_metres: 30 },
  large: { min_area: 20000, max_area: 0, cleanup: 1, smoothing: 1, merge_metres: 100 },
};
const recipe = { id: 'large-change', name: 'Any surface change', description: 'Reflectance that moved',
  phenomenon: 'Surface change', method: 'surface', colour: '#f6a81a', style: 'both',
  parameters: { sensitivity: 67, ...sizes.medium, index: 'ndvi', direction: 'both',
    ignore_clouds: true, ignore_shadows: true, cloud_margin: 5 } };
const vessels = { ...recipe, id: 'boats', name: 'Vessels', method: 'vessels', phenomenon: 'Vessel candidate' };
const methods = [
  { id: 'surface', label: 'Any reflectance change', single: false, clouds: true, sizes,
    measure: 'Reflectance moved by {value}%' },
  { id: 'vessels', label: 'Vessels: infrared contrast over water', single: true, clouds: true, sizes,
    measure: '{value}× brighter than the water around it' },
  { id: 'hotspots', label: 'Hotspots', single: true, clouds: false, sizes,
    measure: 'Short-wave infrared {value}× the bands beside it' },
];
const catalogue = (extra = {}) => ({ builtins: [structuredClone(recipe), structuredClone(vessels)],
  custom: [], methods, max_tiles: 4096, max_results: 2000, grid: [13, 512], ...extra });
const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
const patch = vi.fn();
const del = vi.fn();
const toast = vi.fn();
vi.mock('../../lib/api.js', () => ({ api: { get, post, patch, put, del } }));
vi.mock('../../lib/state.svelte.js', () => ({ ensureCase: async () => ({ id: 'case-a' }),
  reloadCase: async () => {}, toast, uiState: {}, prefs: { units: 'metric' } }));
const { default: Panel } = await import('./DetectPanel.svelte');
const { liveProps } = await import('./props.fixture.svelte.js');
const { refreshRuns } = await import('../../lib/detectRuns.svelte.js');

let live, target;
const settle = async () => { for (let i = 0; i < 120; i++) await Promise.resolve(); flushSync(); };
const button = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
const starts = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(text));
const labelled = (label) => target.querySelector(`button[aria-label="${label}"]`);
const heading = () => target.querySelector('h3')?.textContent.trim();

const area = [{ id: 'area', name: 'Area', kind: 'rect', points: [[2, 48], [2.001, 48.001]] }];
const WATCH = 'abcdef123456';
const RUN = '123456789abc';
const watchRow = (extra = {}) => ({ id: WATCH, title: 'Harbour weekly', created_at: '2026-09-01T00:00:00Z',
  analyzer: 'Vessels', method: 'vessels', colour: '#38bdf8', areas: 1, zones: area,
  date_rule: 'latest_previous', note: 'Weekly look at the anchorage', ...extra });
const watchBody = (extra = {}) => ({ id: WATCH, title: 'Harbour weekly', note: 'Weekly look at the anchorage',
  zones: area, recipe: structuredClone(vessels), a: { provider: 'sentinel2', date: '2026-09-01' },
  b: { provider: 'sentinel2', date: '' }, offline: false, date_rule: 'latest_previous', followup_id: null, ...extra });
const runRow = (extra = {}) => ({ id: RUN, title: 'Harbour weekly', followup_id: WATCH, status: 'ready',
  progress: 1, total: 1, count: 4, to_review: 3, marked: 1, dates: ['2026-09-01', '2026-09-06'],
  created_at: '2026-09-06T10:00:00Z', ...extra });
const finding = (extra = {}) => ({ id: '0-1', run_id: RUN, run_title: 'Harbour weekly', date: '2026-09-06',
  coordinates: [42.95, 14.81], phenomenon: 'Vessel candidate', strength: 'strong', measure: { value: 6.2 },
  review: 'noted', area: 90, ...extra });

/** A GET answered from a table of paths, with the libraries empty by default. */
function answer(table = {}) {
  get.mockImplementation(async (path) => {
    if (path in table) return structuredClone(table[path]);
    return path === '/api/compare/analyzers' ? catalogue() : [];
  });
}

async function open(props = {}) {
  live = mount(Panel, { target, props: { caseId: 'case-a', ...props } });
  await settle();
}

beforeEach(() => {
  vi.clearAllMocks();
  answer();
  target = document.createElement('div'); document.body.append(target);
});
afterEach(async () => {
  if (live) unmount(live);
  live = null;
  target.remove();
  document.body.innerHTML = '';
  await refreshRuns(null);
});

// -- the list ------------------------------------------------------------------

it('opens on the case list, reading local libraries and nothing else', async () => {
  await open();
  expect(get.mock.calls.map(([path]) => path).sort()).toEqual([
    '/api/cases/case-a/analysis/areas', '/api/cases/case-a/analysis/followups', '/api/cases/case-a/analysis/runs',
    '/api/cases/case-a/analysis/zones', '/api/compare/analyzers',
  ]);
  expect(post).not.toHaveBeenCalled();
  expect(target.textContent).toContain('No routine in this case yet.');
  expect(heading()).toBeUndefined();
});

it('asks which kind before asking anything else', async () => {
  await open();
  button('New detection').click(); await settle();
  expect(labelled('New one pass')).toBeDefined();
  expect(labelled('New routine')).toBeDefined();
  labelled('New one pass').click(); await settle();
  expect(heading()).toBe('Where to look');
  expect(target.textContent).toContain('New pass');
});

it('closes the kind menu on a press anywhere else', async () => {
  await open();
  button('New detection').click(); await settle();
  labelled('New one pass').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); await settle();
  expect(labelled('New one pass')).not.toBe(null);
  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); await settle();
  expect(labelled('New one pass')).toBe(null);
});

it('shows a routine with what it is for and where its last run stands', async () => {
  answer({ '/api/cases/case-a/analysis/followups': [watchRow()], '/api/cases/case-a/analysis/runs': [runRow()],
    [`/api/cases/case-a/analysis/followups/${WATCH}`]: watchBody() });
  post.mockResolvedValue({ id: 'fedcba987654', status: 'queued' });
  await open();
  expect(target.textContent).toContain('Weekly look at the anchorage');
  expect(target.textContent).toContain('Vessels · 1 area · newest pass');
  expect(target.textContent).toContain('2026-09-06 · 3 to review');
  labelled('Run Harbour weekly').click(); await settle();
  expect(post).not.toHaveBeenCalled();
  expect(document.querySelector('[aria-label="Dates per area"]')).not.toBe(null);
  button('Run this area').click(); await settle();
  expect(post).toHaveBeenCalledWith(`/api/cases/case-a/analysis/followups/${WATCH}/run`, {
    area_dates: [expect.objectContaining({ area_id: 'area', b: expect.objectContaining({ date: '' }) })],
  });
});

it('queues every routine that is not already working', async () => {
  answer({
    '/api/cases/case-a/analysis/followups': [watchRow(), watchRow({ id: 'bbbbbbbbbbbb', title: 'Airfield' })],
    '/api/cases/case-a/analysis/runs': [runRow({ status: 'running', progress: 2, total: 9, count: 0 })],
  });
  post.mockResolvedValue({ status: 'queued' });
  await open();
  expect(target.textContent).toContain('Running · 2/9 tiles');
  button('Run all').click(); await settle();
  expect(post.mock.calls.map(([path]) => path)).toEqual(['/api/cases/case-a/analysis/followups/bbbbbbbbbbbb/run']);
  expect(toast).toHaveBeenCalledWith('1 routine queued', 'ok');
});

it('groups the saved runs by routine, and puts one on the map beside its trash', async () => {
  const once = runRow({ id: 'cccccccccccc', title: 'Port sweep', followup_id: null, analyzer: 'Vessels', areas: 1,
    count: 0, to_review: 0, marked: 0 });
  const full = (row) => ({ ...row, engine_version: 2, frames: {}, results: [],
    input: { title: row.title, zones: area, recipe: structuredClone(vessels), note: '', followup_id: row.followup_id,
      a: { provider: 'sentinel2', date: '2026-09-01' }, b: { provider: 'sentinel2', date: '2026-09-06' },
      offline: false, date_rule: 'manual' } });
  answer({
    '/api/cases/case-a/analysis/followups': [watchRow()],
    '/api/cases/case-a/analysis/runs': [runRow(), once],
    [`/api/cases/case-a/analysis/runs/${RUN}`]: full(runRow()),
    '/api/cases/case-a/analysis/runs/cccccccccccc': full(once),
  });
  const onframe = vi.fn();
  await open({ onframe });
  button('Saved').click(); await settle();
  expect([...target.querySelectorAll('.fold .name')].map((node) => node.textContent)).toEqual(['Harbour weekly', 'One passes']);
  // under its routine a run is told apart by its days, the routine being named above
  expect(target.textContent).toContain('2026-09-06 · 3 to review');
  expect(target.textContent).toContain('2026-09-01 → 2026-09-06');
  expect(target.textContent).toContain('Vessels · 1 area');
  // every finished run is on the map from the start, and turns off beside its trash
  const eye = labelled('Hide Port sweep on the map');
  expect(eye.nextElementSibling.getAttribute('aria-label')).toBe('Delete Port sweep');
  eye.click(); await settle();
  expect(onframe).not.toHaveBeenCalled();
  labelled('Show Port sweep on the map').click(); await settle();
  expect(onframe).toHaveBeenCalledWith(area);
  // a routine's runs go off and on together
  labelled('Hide every run of Harbour weekly on the map').click(); await settle();
  expect(labelled('Show Harbour weekly · 2026-09-01 → 2026-09-06 on the map')).not.toBe(null);
  // what was kept goes to the SAT layers from here, a routine's runs into its one layer
  post.mockResolvedValue({});
  labelled('Add Harbour weekly to the SAT layers').click(); await settle();
  expect(post).toHaveBeenCalledWith(`/api/cases/case-a/analysis/followups/${WATCH}/export`, {});
  labelled('Add Harbour weekly · 2026-09-01 → 2026-09-06 to the SAT layers').click(); await settle();
  expect(post).toHaveBeenCalledWith(`/api/cases/case-a/analysis/runs/${RUN}/export`, {});
  expect(toast).toHaveBeenCalledWith('Snapshot saved in SAT layers', 'ok');
  // a run with nothing kept has nothing to give a layer, and says so
  const empty = labelled('Add Port sweep to the SAT layers');
  expect(empty.disabled).toBe(true);
  expect(empty.getAttribute('title')).toContain('Keep or pin a candidate first');
  // and a group folds shut
  const fold = [...target.querySelectorAll('.fold')].find((node) => node.textContent.includes('Harbour weekly'));
  fold.click(); await settle();
  expect(fold.getAttribute('aria-expanded')).toBe('false');
  expect(target.textContent).not.toContain('2026-09-06 · 3 to review');
});

it('reshapes a shared area on the map, saying what its routines will sweep', async () => {
  const ring = [[2, 48], [2.01, 48], [2.01, 48.01], [2, 48.01], [2, 48]];
  const shared = { id: 'aaaaaaaaaaaa', name: 'North site', colour: '#38bdf8', geometry: { type: 'Polygon', coordinates: [ring] } };
  answer({
    '/api/cases/case-a/analysis/areas': [shared],
    '/api/cases/case-a/analysis/followups': [watchRow({ zones: [{ id: shared.id, name: shared.name, kind: 'polygon', points: ring.slice(0, -1) }] })],
  });
  put.mockResolvedValue({});
  post.mockResolvedValue({});
  const onframe = vi.fn();
  await open({ onframe });
  button('Areas').click(); await settle();
  labelled('Edit North site').click(); await settle();
  button('Reshape on the map').click(); await settle();
  // the map goes to the area, and the panel says who follows the new shape
  expect(onframe).toHaveBeenCalledWith([{ kind: 'polygon', points: ring }]);
  expect(target.textContent).toContain('1 routine watches it: the next runs sweep the new shape.');
  expect(target.textContent).toContain('Finished runs keep the ground they swept.');
  button('Cancel').click(); await settle();
  expect(target.querySelector('[aria-label="Reshaping North site"]')).toBe(null);
  expect(put).not.toHaveBeenCalled();

  labelled('Edit North site').click(); await settle();
  button('Reshape on the map').click(); await settle();
  button('Save shape').click(); await settle();
  expect(put).toHaveBeenCalledWith('/api/cases/case-a/analysis/areas/aaaaaaaaaaaa',
    { name: 'North site', colour: '#38bdf8', geometry: { type: 'Polygon', coordinates: [ring] } });

  // a new area leaves the old one, and its routines, as they were
  labelled('Edit North site').click(); await settle();
  button('Reshape on the map').click(); await settle();
  button('Save as a new area').click(); await settle();
  expect(post).toHaveBeenCalledWith('/api/cases/case-a/analysis/areas',
    { name: 'North site · new shape', colour: '#38bdf8', geometry: { type: 'Polygon', coordinates: [ring] } });
  expect(put).toHaveBeenCalledTimes(1);
});

// -- a routine's own page ---------------------------------------------------------

it('opens a routine on what it has found, and runs it again on a chosen pass', async () => {
  answer({
    '/api/cases/case-a/analysis/followups': [watchRow()],
    '/api/cases/case-a/analysis/runs': [runRow()],
    [`/api/cases/case-a/analysis/followups/${WATCH}`]: watchBody(),
    [`/api/cases/case-a/analysis/followups/${WATCH}/findings`]: [finding(), finding({ id: '0-2', review: 'kept' })],
  });
  post.mockImplementation(async (path) => (path.endsWith('/acquisitions')
    ? { dates: [{ date: '2026-09-16', cloud: 4, granules: 1, coverage: 1 }], truncated: false }
    : { id: 'fedcba987654', status: 'queued' }));
  await open();
  button('Harbour weekly').click(); await settle();
  expect(heading()).toBe('Harbour weekly');
  expect(target.textContent).toContain('Weekly look at the anchorage');
  // what it has found, across every run, with how each one was kept
  expect(target.textContent).toContain('Kept here');
  expect(target.textContent).toContain('Pinned');
  expect(target.textContent).toContain('Vessel candidate · Strong · 6.2× brighter than the water around it');

  // a routine is relaunched against a day, and asks which one
  button('Run routine').click(); await settle();
  button('Find passes').click(); await settle();
  expect(post).toHaveBeenCalledWith('/api/satellite/sentinel/acquisitions', expect.objectContaining({ zones: area }));
  button('Use').click(); await settle();
  button('Run this area').click(); await settle();
  expect(post).toHaveBeenCalledWith(`/api/cases/case-a/analysis/followups/${WATCH}/run`, { area_dates: [expect.objectContaining({ b: expect.objectContaining({ date: '2026-09-16' }) })] });
});

it('lists a routine\'s runs, and opens one on its candidates', async () => {
  const saved = { ...runRow(), engine_version: 2, frames: {}, results: [],
    input: { title: 'Harbour weekly', zones: area, recipe: structuredClone(vessels), followup_id: WATCH,
      a: { provider: 'sentinel2', date: '2026-09-01' }, b: { provider: 'sentinel2', date: '2026-09-06' },
      offline: false, date_rule: 'latest_previous' } };
  answer({
    '/api/cases/case-a/analysis/followups': [watchRow()],
    '/api/cases/case-a/analysis/runs': [runRow()],
    [`/api/cases/case-a/analysis/followups/${WATCH}`]: watchBody(),
    [`/api/cases/case-a/analysis/runs/${RUN}`]: saved,
  });
  await open();
  button('Harbour weekly').click(); await settle();
  starts('Runs').click(); await settle();
  starts('2026-09-06 · 3 to review').click(); await settle();
  expect(target.textContent).toContain('Completed · 1 tile · 2026-09-06');
});

// -- building one ------------------------------------------------------------------

it('walks a single pass through its steps and runs it once', async () => {
  answer({ '/api/cases/case-a/analysis/zones/aaaaaaaaaaaa': { id: 'aaaaaaaaaaaa', title: 'Port', zones: area } });
  post.mockResolvedValue({ id: RUN, status: 'queued', input: {}, results: [], total: 1, progress: 0 });
  await open({ opening: 'zones-aaaaaaaaaaaa' });
  expect(heading()).toBe('Where to look');
  expect(target.textContent).toContain('1 tile · 4 requests a run');
  button('Next: What').click(); await settle();
  expect(heading()).toBe('What to look for');
  button('Next: When').click(); await settle();
  expect(heading()).toBe('Which two images');
  // a pair needs A, and says so in the words of the step
  expect(button('Next: Start').disabled).toBe(true);
  expect(target.textContent).toContain('Choose A, the picture before.');
  // B is the newest pass until a day is asked for, and then it needs one
  expect(button('Newest pass').getAttribute('aria-checked')).toBe('true');
  button('A day I choose').click(); await settle();
  const pass = target.querySelector('[aria-label="Day of B"]');
  pass.value = '06/09/2026'; pass.dispatchEvent(new Event('input', { bubbles: true })); await settle();
  expect(target.textContent).toContain('Choose A, the picture before.');
  // the passes are listed in the step itself, and only when asked for
  expect(post).not.toHaveBeenCalled();
  post.mockImplementationOnce(async () => ({
    dates: [{ date: '2026-08-01', cloud: 2, granules: 1, coverage: 1 }], truncated: false }));
  button('Find passes').click(); await settle();
  expect(post).toHaveBeenCalledWith('/api/satellite/sentinel/acquisitions', expect.objectContaining({ zones: area }));
  button('A').click(); await settle();
  expect(button('Next: Start').disabled).toBe(false);
  button('Next: Start').click(); await settle();
  expect(heading()).toBe('Name and start');
  expect(target.textContent).toContain('2026-08-01 → 2026-09-06');
  const note = target.querySelector('[aria-label="Detection description"]');
  note.value = 'Checking the strike'; note.dispatchEvent(new Event('input', { bubbles: true }));
  button('Run this pass').click(); await settle();
  expect(post).toHaveBeenCalledWith('/api/cases/case-a/analysis/runs', expect.objectContaining({
    zones: area, date_rule: 'manual', note: 'Checking the strike', followup_id: null,
    area_dates: [expect.objectContaining({ a: expect.objectContaining({ date: '2026-08-01' }), b: expect.objectContaining({ date: '2026-09-06' }) })],
  }));
});

it('asks a routine what each pass compares against, not which day to read', async () => {
  const set = { id: 'aaaaaaaaaaaa', title: 'Port', zones: area, areas: 1 };
  let saved = [];
  get.mockImplementation(async (path) => {
    if (path === '/api/compare/analyzers') return catalogue();
    if (path === '/api/cases/case-a/analysis/zones') return [set];
    if (path === '/api/cases/case-a/analysis/zones/aaaaaaaaaaaa') return structuredClone(set);
    if (path === '/api/cases/case-a/analysis/followups') return structuredClone(saved);
    if (path === `/api/cases/case-a/analysis/followups/${WATCH}`) return watchBody();
    return [];
  });
  post.mockImplementation(async (path, body) => {
    if (path.endsWith('/acquisitions')) {
      return { dates: [{ date: '2026-08-01', cloud: 2, granules: 1, coverage: 1 }], truncated: false };
    }
    if (path.endsWith('/followups')) {
      saved = [watchRow()];
      return { ...body, id: WATCH };
    }
    return { id: RUN, status: 'queued' };
  });
  await open();
  button('New detection').click(); await settle();
  labelled('New routine').click(); await settle();
  expect(target.textContent).toContain('New routine');
  button('Port1 area').click(); await settle();
  button('Next: What').click(); await settle();
  button('Next: When').click(); await settle();
  expect(heading()).toBe('Which images, each run');
  expect(target.textContent).toContain('Each run takes the newest pass as B and compares it with');
  expect(target.textContent).toContain('The pass before');
  expect(target.textContent).toContain('Only the first run');
  expect(target.textContent).toContain('Choose A, the picture the first run compares with.');
  // a routine names no B: the list offers A alone
  button('Find passes').click(); await settle();
  expect(button('B')).toBeUndefined();
  button('A').click(); await settle();
  button('Next: Start').click(); await settle();
  expect(target.textContent).toContain('Each run: the newest pass against the one before, first against 2026-08-01');
  button('Save and run the first pass').click(); await settle();
  expect(post).toHaveBeenCalledWith('/api/cases/case-a/analysis/followups', expect.objectContaining({
    date_rule: 'latest_previous', zones: area, area_dates: [expect.objectContaining({ a: expect.objectContaining({ date: '2026-08-01' }) })],
  }));
  expect(post).toHaveBeenCalledWith(`/api/cases/case-a/analysis/followups/${WATCH}/run`, {});
  // it lands on the routine's own page, where its runs gather
  expect(heading()).toBe('Harbour weekly');
});

it('reads the newest pass for a one-image sweep unless a day is asked for', async () => {
  answer({
    '/api/compare/analyzers': catalogue({ builtins: [structuredClone(vessels), structuredClone(recipe)] }),
    '/api/cases/case-a/analysis/zones/aaaaaaaaaaaa': { id: 'aaaaaaaaaaaa', title: 'Port', zones: area },
  });
  post.mockImplementation(async (path) => (path.endsWith('/acquisitions')
    ? { dates: [{ date: '2026-09-16', cloud: 4, granules: 1, coverage: 1 }], truncated: false }
    : { id: RUN, status: 'queued', input: {}, results: [], total: 1, progress: 0 }));
  await open({ opening: 'zones-aaaaaaaaaaaa' });
  button('Next: What').click(); await settle();
  button('Next: When').click(); await settle();
  expect(heading()).toBe('Which image');
  // the newest pass is a whole answer, so the step can be passed as it opens
  expect(target.textContent).toContain('Looked up when the run starts, under the cloud ceiling.');
  expect(target.querySelector('[aria-label="Day of A"]')).toBe(null);
  expect(button('Next: Start').disabled).toBe(false);
  button('A day I choose').click(); await settle();
  expect(button('Next: Start').disabled).toBe(true);
  expect(target.textContent).toContain('Choose the day, or take the newest pass.');
  button('Find passes').click(); await settle();
  button('Use').click(); await settle();
  button('Next: Start').click(); await settle();
  expect(target.textContent).toContain('2026-09-16');
  button('Run this pass').click(); await settle();
  expect(post).toHaveBeenCalledWith('/api/cases/case-a/analysis/runs', expect.objectContaining({
    area_dates: [expect.objectContaining({ date_rule: 'manual', b: expect.objectContaining({ date: '2026-09-16' }) })],
  }));
});

it('gives every area the same days, and keeps a table for areas that differ', async () => {
  const two = [...area, { id: 'far', name: 'Far', kind: 'rect', points: [[9, 40], [9.001, 40.001]] }];
  answer({ '/api/cases/case-a/analysis/zones/aaaaaaaaaaaa': { id: 'aaaaaaaaaaaa', title: 'Port', zones: two } });
  post.mockImplementation(async (path) => (path.endsWith('/acquisitions')
    ? { dates: [{ date: '2026-08-01', cloud: 2, granules: 2, coverage: 1 }], truncated: false }
    : { id: RUN, status: 'queued', input: {}, results: [], total: 1, progress: 0 }));
  await open({ opening: 'zones-aaaaaaaaaaaa' });
  button('Next: What').click(); await settle();
  button('Next: When').click(); await settle();
  expect(target.textContent).toContain('Passes over these areas');
  // one lookup over both, so a pass that covers them all says so
  button('Find passes').click(); await settle();
  expect(post).toHaveBeenCalledWith('/api/satellite/sentinel/acquisitions', expect.objectContaining({ zones: two }));
  button('A').click(); await settle();
  expect(target.textContent).toContain('The same days for all 2 areas.');
  button('Set them per area…').click(); await settle();
  const far = document.querySelector('[aria-label="Reference for Far"]');
  far.value = '20/07/2026'; far.dispatchEvent(new Event('input', { bubbles: true })); await settle();
  button('Done').click(); await settle();
  expect(target.textContent).toContain('The areas have days of their own.');
  expect(target.textContent).toContain('A 2026-07-20 → B newest pass');
  button('Next: Start').click(); await settle();
  expect(target.textContent).toContain('Its own days for each area');
  button('Run this pass').click(); await settle();
  expect(post).toHaveBeenCalledWith('/api/cases/case-a/analysis/runs', expect.objectContaining({
    area_dates: [
      expect.objectContaining({ area_id: 'area', a: expect.objectContaining({ date: '2026-08-01' }) }),
      expect.objectContaining({ area_id: 'far', a: expect.objectContaining({ date: '2026-07-20' }) }),
    ],
  }));
});

it('asks a routine of one image for nothing but its picture', async () => {
  const set = { id: 'aaaaaaaaaaaa', title: 'Port', zones: area, areas: 1 };
  answer({ '/api/compare/analyzers': catalogue({ builtins: [structuredClone(vessels)] }),
    '/api/cases/case-a/analysis/zones': [set], '/api/cases/case-a/analysis/zones/aaaaaaaaaaaa': set });
  await open();
  button('New detection').click(); await settle();
  labelled('New routine').click(); await settle();
  button('Port1 area').click(); await settle();
  button('Next: What').click(); await settle();
  button('Next: When').click(); await settle();
  expect(heading()).toBe('Which image, each run');
  expect(target.textContent).toContain('Each run reads the newest pass over the area, under the cloud ceiling.');
  expect(button('Find passes')).toBeUndefined();
  expect(button('Next: Start').disabled).toBe(false);
  button('Next: Start').click(); await settle();
  expect(target.textContent).toContain('Each run: the newest pass');
  expect(post).not.toHaveBeenCalled();
});

it('holds a routine to one fixed picture when asked', async () => {
  const set = { id: 'aaaaaaaaaaaa', title: 'Port', zones: area, areas: 1 };
  answer({ '/api/cases/case-a/analysis/zones': [set], '/api/cases/case-a/analysis/zones/aaaaaaaaaaaa': set,
    [`/api/cases/case-a/analysis/followups/${WATCH}`]: watchBody({ date_rule: 'latest_reference' }) });
  post.mockImplementation(async (_, body) => ({ ...body, id: WATCH }));
  await open();
  button('New detection').click(); await settle();
  labelled('New routine').click(); await settle();
  button('Port1 area').click(); await settle();
  button('Next: What').click(); await settle();
  button('Next: When').click(); await settle();
  [...target.querySelectorAll('[role="radio"]')].find((node) => node.textContent.includes('A fixed picture')).click();
  await settle();
  expect(target.textContent).toContain('Every run compares with');
  expect(target.textContent).toContain('Choose A, the picture every run compares with.');
  const day = target.querySelector('[aria-label="Day of A"]');
  day.value = '01/08/2026'; day.dispatchEvent(new Event('input', { bubbles: true })); await settle();
  button('Next: Start').click(); await settle();
  expect(target.textContent).toContain('Each run: the newest pass against 2026-08-01');
  button('Save without running').click(); await settle();
  expect(post).toHaveBeenCalledWith('/api/cases/case-a/analysis/followups', expect.objectContaining({
    date_rule: 'latest_reference',
    area_dates: [expect.objectContaining({ date_rule: 'latest_reference', a: expect.objectContaining({ date: '2026-08-01' }),
      b: expect.objectContaining({ date: '' }) })],
  }));
});

it('refuses an area the engine would reject before the next step', async () => {
  const zones = [{ id: 'big', name: 'Whole region', kind: 'rect', points: [[2, 48], [8, 54]] }];
  answer({
    '/api/compare/analyzers': catalogue({ max_tiles: 256 }),
    '/api/cases/case-a/analysis/zones/aaaaaaaaaaaa': { id: 'aaaaaaaaaaaa', title: 'Region', zones },
  });
  await open({ opening: 'zones-aaaaaaaaaaaa' });
  expect(button('Next: What').disabled).toBe(true);
  expect(target.textContent).toContain('the limit is 256');
  expect(post).not.toHaveBeenCalled();
});

it('sets a size as a whole set of numbers, and shows when it was tuned by hand', async () => {
  answer({ '/api/cases/case-a/analysis/zones/aaaaaaaaaaaa': { id: 'aaaaaaaaaaaa', title: 'Port', zones: area } });
  await open({ opening: 'zones-aaaaaaaaaaaa' });
  button('Next: What').click(); await settle();
  const pressed = () => [...target.querySelectorAll('[aria-label="Target size"] button')]
    .filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent.trim());
  expect(pressed()).toEqual(['Medium']);
  button('Small').click(); await settle();
  expect(pressed()).toEqual(['Small']);
  button('Adjust thresholds…').click(); await settle();
  const minimum = target.querySelector('[aria-label="Minimum area"]');
  expect(minimum.value).toBe('300');
  minimum.value = '120'; minimum.dispatchEvent(new Event('input', { bubbles: true })); await settle();
  expect(pressed()).toEqual([]);
});

it('offers the cloud switch on by default, and none for a method that rejects cloud itself', async () => {
  answer({ '/api/cases/case-a/analysis/zones/aaaaaaaaaaaa': { id: 'aaaaaaaaaaaa', title: 'Port', zones: area } });
  await open({ opening: 'zones-aaaaaaaaaaaa' });
  button('Next: What').click(); await settle();
  const chip = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Clouds & shadows'));
  expect(chip.getAttribute('aria-pressed')).toBe('true');
  expect(target.textContent).toContain('traced from the sun');
  unmount(live); target.innerHTML = '';
  answer({
    '/api/compare/analyzers': catalogue({ builtins: [{ ...structuredClone(recipe), id: 'anomaly', method: 'hotspots' }] }),
    '/api/cases/case-a/analysis/zones/aaaaaaaaaaaa': { id: 'aaaaaaaaaaaa', title: 'Port', zones: area },
  });
  await open({ opening: 'zones-aaaaaaaaaaaa' });
  button('Next: What').click(); await settle();
  expect(target.textContent).not.toContain('Clouds & shadows');
});

it('says what a partial pass will leave unswept before the run, not after', async () => {
  answer({ '/api/cases/case-a/analysis/zones/aaaaaaaaaaaa': { id: 'aaaaaaaaaaaa', title: 'Port', zones: area } });
  post.mockResolvedValue({ dates: [{ date: '2026-05-04', cloud: 12, granules: 1, coverage: 0.62 }], truncated: false });
  await open({ opening: 'zones-aaaaaaaaaaaa' });
  button('Next: What').click(); await settle();
  button('Next: When').click(); await settle();
  // Pass lookups stay explicit.
  expect(target.querySelector('input[type="date"]')).toBe(null);
  expect(post).not.toHaveBeenCalled();
  button('Find passes').click(); await settle();
  button('B').click(); await settle();
  expect(document.body.textContent).toContain('reaches 62% of the areas');
  expect(document.body.textContent).toContain('not swept');
});

// -- the analyzers -------------------------------------------------------------------

it('makes an analyzer of its own from the closest built-in, and never writes over one', async () => {
  post.mockImplementation(async (_, body) => ({ ...body, id: 'custom-copy' }));
  await open();
  labelled('Analyzers').click(); await settle();
  expect(target.textContent).toContain('build your own from rules you try on the map, or copy a calibrated built-in');
  starts('Vessels').click(); await settle();
  expect(target.textContent).toContain('Measures Vessels: infrared contrast over water');
  expect(button('Save changes')).toBeUndefined();
  expect(button('Copy to tune')).toBeDefined();
  button('Back').click(); await settle();

  button('New analyzer').click(); await settle();
  expect(heading()).toBe('Or start from a built-in');
  [...target.querySelectorAll('button.base')].find((b) => b.textContent.includes(recipe.name)).click(); await settle();
  const name = target.querySelector('[aria-label="Analyzer name"]');
  expect(name.value).toBe(`${recipe.name} copy`);
  name.value = 'Weekly harbour'; name.dispatchEvent(new Event('input', { bubbles: true }));
  button('Add to my analyzers').click(); await settle();
  expect(post).toHaveBeenCalledWith('/api/compare/analyzers',
    expect.objectContaining({ id: 'custom', name: 'Weekly harbour', method: 'surface' }));
});

it('edits and removes an analyzer of its own', async () => {
  const own = { ...structuredClone(recipe), id: 'custom-1', name: 'Weekly harbour' };
  answer({ '/api/compare/analyzers': catalogue({ custom: [own] }) });
  await open();
  labelled('Analyzers').click(); await settle();
  labelled('Edit Weekly harbour').click(); await settle();
  expect(button('Save changes')).toBeDefined();
  button('Cancel').click(); await settle();
  labelled('Delete Weekly harbour').click(); await settle();
  expect(del).toHaveBeenCalledWith('/api/compare/analyzers/custom-1');
});

// -- analyzers of your own rules ------------------------------------------------------

const rulesMethods = [...methods, { id: 'rules', label: 'Your own rules', single: false, clouds: true,
  sensor: 'sentinel2', frames: 4, sizes, measure: '', rules: true },
{ id: 'sar-change', label: 'Radar change', single: false, clouds: false, sensor: 'sentinel1', frames: 4,
  sizes, measure: '', smoothing_m: 45 }];
const rulesCatalogue = (extra = {}) => catalogue({ methods: rulesMethods, rules: {
  bands: ['B02', 'B03', 'B04', 'B08', 'B11', 'B12'], classes: ['vegetation', 'bare', 'water'],
  max_rules: 6, max_bands: 6, max_around: 300, max_checks: 12, max_marks: 20, preview_span: 3 }, ...extra });
const VIEW = { west: 2, south: 48, east: 2.05, north: 48.03 };
const PREVIEWED = { ready: true, missing: 0, tiles: [[4230, 2930]], clipped: false,
  box: { west: 0, south: 0, east: 1, north: 1 }, size: [512, 512], mask: '', measured: 0.9,
  rules: [{ share: 0.012, kept: 0.012 }], kept: 0.01, count: 1, note: '',
  candidates: [{ id: '0-1', coordinates: [2.01, 48.01], bbox: [2.01, 48.01, 2.011, 48.011], area: 900,
    margin: 4, strength: 'strong', measure: {}, geometry: null }] };
const debounce = (ms = 320) => new Promise((resolve) => setTimeout(resolve, ms));
const phrase = () => [...target.querySelectorAll('.phrase')].map((p) => p.textContent.trim())[0];
const tab = (name) => [...target.querySelectorAll('[role="tab"]')].find((b) => b.textContent.trim().startsWith(name));
const rule = (extra = {}) => ({ measure: 'index', index: 'nbr', bands: ['B08', 'B04'], band: 'B08', polarisation: 'vv',
  classes: [], on: 'change', op: 'le', value: -0.2, upper: 0, around: 0, ...extra });

function copernicus(previewed = PREVIEWED, checked = () => ({ ready: true, missing: 0, count: 1, covered: [true] })) {
  post.mockImplementation(async (path, body) => {
    if (path === '/api/satellite/sentinel/acquisitions') {
      return { dates: [{ date: '2026-05-11', cloud: 5, coverage: 1 }, { date: '2026-05-04', cloud: 3, coverage: 1 }], truncated: false };
    }
    if (path === '/api/compare/analyzers/preview') {
      return body.read ? previewed : { ready: false, missing: 2, tiles: [[4230, 2930]], clipped: false, box: {}, size: [512, 512] };
    }
    if (path === '/api/compare/analyzers/probe') {
      return { ready: true, imaged: true, measured: true, kept: true, rules: [{ passes: true, value: -0.6, before: 0.8, after: 0.2 }] };
    }
    if (path === '/api/compare/analyzers/check') return checked(body);
    return { ...body, id: 'custom-aaaaaaaaaaaa' };
  });
}

async function openBuilder(props = {}) {
  await open({ viewBounds: () => VIEW, ...props });
  labelled('Analyzers').click(); await settle();
  button('New analyzer').click(); await settle();
  starts('Build your own rules').click(); await settle();
}

/** Pick the two passes of the view and read its frames. */
async function readTheView() {
  button('Find passes').click(); await settle();
  target.querySelector('[aria-label="Use 2026-05-04"] button').click(); await settle();
  target.querySelectorAll('[aria-label="Use 2026-05-11"] button')[1].click(); await settle();
  await debounce(); await settle();
  button('Show the detections here').click(); await settle();
}

it('builds an analyzer from rules, tries it on the view, reads a point and keeps it for every case', async () => {
  answer({ '/api/compare/analyzers': rulesCatalogue() });
  copernicus();
  await openBuilder();
  expect(heading()).toBe('Build an analyzer');
  expect(target.textContent).toContain('Pick pass A and pass B to try the rules on.');
  expect(phrase()).toBe('Keeps ground where NDVI dropped by 0.25 or more, outside cloud.');
  expect(tab('Rules').getAttribute('aria-selected')).toBe('true');
  // building reads nothing: the pass lookup and the frames each wait to be asked for
  await debounce(); await settle();
  expect(post).not.toHaveBeenCalled();

  button('Find passes').click(); await settle();
  expect(post).toHaveBeenCalledWith('/api/satellite/sentinel/acquisitions', expect.objectContaining({ collection: 'sentinel2' }));
  target.querySelector('[aria-label="Use 2026-05-04"] button').click(); await settle();
  target.querySelectorAll('[aria-label="Use 2026-05-11"] button')[1].click(); await settle();
  await debounce(); await settle();
  const asked = post.mock.calls.filter(([path]) => path === '/api/compare/analyzers/preview');
  expect(asked).toHaveLength(1);
  expect(asked[0][1]).toMatchObject({ read: false, a: { date: '2026-05-04' }, b: { date: '2026-05-11' }, bounds: VIEW,
    recipe: { method: 'rules', match: 'all' } });
  expect(target.textContent).toContain('2 frames from Copernicus, one request each.');

  button('Show the detections here').click(); await settle();
  expect(post).toHaveBeenLastCalledWith('/api/compare/analyzers/preview', expect.objectContaining({ read: true }));
  expect(target.textContent).toContain('1 candidate on the map');
  expect(target.textContent).toContain('1.2 % of the ground');

  await live.probeAt({ lon: 2.01, lat: 48.01 }); await settle();
  expect(post).toHaveBeenLastCalledWith('/api/compare/analyzers/probe', expect.objectContaining({ point: [2.01, 48.01] }));

  expect(button('Add to my analyzers').disabled).toBe(true);
  const name = target.querySelector('[aria-label="Analyzer name"]');
  name.value = 'Cleared ground'; name.dispatchEvent(new Event('input', { bubbles: true })); await settle();
  button('Add to my analyzers').click(); await settle();
  expect(post).toHaveBeenCalledWith('/api/compare/analyzers', expect.objectContaining({
    id: 'custom', method: 'rules', name: 'Cleared ground', match: 'all', checks: [],
    description: 'Keeps ground where NDVI dropped by 0.25 or more, outside cloud.',
    rules: [expect.objectContaining({ measure: 'index', index: 'ndvi', on: 'change', op: 'le', value: -0.25 })] }));
  // no check was asked for, so none was read
  expect(post.mock.calls.some(([path]) => path === '/api/compare/analyzers/check')).toBe(false);
});

const EXAMPLE = { id: 'burn', place: 'Lahaina, Maui', when: 'August 2023', recipe: {
  id: 'custom', name: 'Fresh burn', description: 'The burn ratio dropped.', phenomenon: 'Fresh burn', method: 'rules',
  colour: '#ef4444', style: 'both', match: 'all', parameters: { ...recipe.parameters, shape: 'any', merge_metres: 30 },
  rules: [rule(), rule({ on: 'b', value: 0.1 })],
  checks: [
    { id: 'town', name: 'The town that burned', a: { provider: 'sentinel2', date: '2023-08-08', layer: 'SWIR', maxcc: 100 },
      b: { provider: 'sentinel2', date: '2023-08-13', layer: 'SWIR', maxcc: 100 },
      bounds: { west: -156.69, south: 20.86, east: -156.66, north: 20.90 },
      marks: [{ point: [-156.675, 20.872], expect: 'found' }, { point: [-156.675, 20.894], expect: 'found' }], result: null },
    { id: 'reef', name: 'The reef off the town', a: { provider: 'sentinel2', date: '2023-08-08', layer: 'SWIR', maxcc: 100 },
      b: { provider: 'sentinel2', date: '2023-08-13', layer: 'SWIR', maxcc: 100 },
      bounds: { west: -156.69, south: 20.85, east: -156.66, north: 20.87 },
      marks: [{ point: [-156.6753, 20.865], expect: 'empty' }], result: null },
  ] } };

it('starts from an example: copies it with its checks, opens on them and reads them when asked', async () => {
  answer({ '/api/compare/analyzers': rulesCatalogue({ examples: [EXAMPLE] }) });
  let reads = 0;
  copernicus(PREVIEWED, (body) => {
    if (!body.read) return { ready: false, missing: 2 };
    reads++;
    // the reef gets a candidate on it: the check that should stay empty does not
    return { ready: true, missing: 0, count: 3, covered: body.check.id === 'town' ? [true, true] : [true] };
  });
  const onfly = vi.fn();
  const onshow = vi.fn();
  await open({ viewBounds: () => VIEW, onfly, onshow });
  labelled('Analyzers').click(); await settle();
  button('New analyzer').click(); await settle();
  expect(target.textContent).toContain('Start from an example');
  expect(target.textContent).toContain('Lahaina, Maui · August 2023 · 2 checks');
  labelled('Start from the example Fresh burn').click(); await settle();

  // it is in the library at once, under a name of its own, checks and all
  expect(post).toHaveBeenCalledWith('/api/compare/analyzers', expect.objectContaining({
    id: 'custom', name: 'Fresh burn', checks: EXAMPLE.recipe.checks }));
  expect(toast).toHaveBeenCalledWith('Fresh burn is in your analyzers, with its checks', 'ok');
  expect(heading()).toBe('Edit Fresh burn');
  expect(tab('Checks').getAttribute('aria-selected')).toBe('true');
  // the first check is on the bench: its ground, its passes, B in its layer
  expect(onfly).toHaveBeenCalledWith({ bounds: EXAMPLE.recipe.checks[0].bounds });
  expect(onshow).toHaveBeenLastCalledWith({ provider: 'sentinel2', date: '2023-08-13', layer: 'SWIR', maxcc: 100 });
  expect(target.textContent).toContain('A 2023-08-08 → B 2023-08-13');

  // the cache is read on its own; what it lacks waits for Run all, which says the cost
  await debounce(900); await settle();
  const dry = post.mock.calls.filter(([path, body]) => path === '/api/compare/analyzers/check' && !body.read);
  expect(dry).toHaveLength(2);
  expect(dry[0][1]).toMatchObject({ recipe: { method: 'rules' }, check: { id: 'town', result: null } });
  expect(reads).toBe(0);
  expect(starts('Run all').textContent.trim()).toBe('Run all · up to 4 requests');
  expect(target.textContent).toContain('2 frames to read');

  starts('Run all').click(); await settle();
  expect(reads).toBe(2);
  expect(target.textContent).toContain('2 of 2 found');
  expect(target.textContent).toContain('1 of 1 flagged');
  expect(tab('Checks').textContent.replace(/\s+/g, '')).toBe('Checks1/2');
});

it('marks a point read on the map in a check, which turns red when a rule loses it', async () => {
  answer({ '/api/compare/analyzers': rulesCatalogue() });
  let found = true;
  copernicus(PREVIEWED, () => ({ ready: true, missing: 0, count: 1, covered: [found] }));
  await openBuilder();
  await readTheView();
  await live.probeAt({ lon: 2.01, lat: 48.01 }); await settle();
  live.markProbe('found'); await settle();

  // no check was on the bench, so the view became one, with the passes shown
  expect(tab('Checks').getAttribute('aria-selected')).toBe('true');
  expect(target.textContent).toContain('Check 1');
  await debounce(900); await settle();
  const first = post.mock.calls.filter(([path]) => path === '/api/compare/analyzers/check').at(-1)[1];
  expect(first).toMatchObject({ read: false, check: { name: 'Check 1', bounds: VIEW,
    a: { date: '2026-05-04' }, b: { date: '2026-05-11' }, marks: [{ point: [2.01, 48.01], expect: 'found' }] } });
  expect(target.textContent).toContain('1 of 1 found');
  // the result written back asks for no other read, and a read from the cache never says Reading…
  const reads = () => post.mock.calls.filter(([path]) => path === '/api/compare/analyzers/check').length;
  const settled = reads();
  await debounce(1600); await settle();
  expect(reads()).toBe(settled);
  expect(target.textContent).not.toContain('Reading…');

  // a stricter line loses it: the check is reread from the cache and says so
  found = false;
  tab('Rules').click(); await settle();
  const value = target.querySelector('[aria-label="Rule 1 value"]');
  value.value = '-0.6'; value.dispatchEvent(new Event('change', { bubbles: true })); await settle();
  await debounce(900); await settle();
  tab('Checks').click(); await settle();
  expect(target.textContent).toContain('0 of 1 found');
  expect(tab('Checks').textContent.replace(/\s+/g, '')).toBe('Checks0/1');

  const name = target.querySelector('[aria-label="Analyzer name"]');
  name.value = 'Cleared ground'; name.dispatchEvent(new Event('input', { bubbles: true })); await settle();
  button('Add to my analyzers').click(); await settle();
  const saved = post.mock.calls.find(([path]) => path === '/api/compare/analyzers')[1];
  expect(saved.checks).toEqual([expect.objectContaining({ name: 'Check 1',
    result: expect.objectContaining({ count: 1, covered: [false] }) })]);
  expect(saved.checks[0].result.signature).toMatch(/^[0-9a-z]+$/);
});

it('adds a check where the map is: pick its passes, drop pins with the map, done', async () => {
  answer({ '/api/compare/analyzers': rulesCatalogue() });
  copernicus();
  let view = VIEW;
  const props = liveProps({ caseId: 'case-a', viewBounds: () => view, mapView: { lat: 48, lon: 2, zoom: 13 } });
  live = mount(Panel, { target, props });
  await settle();
  labelled('Analyzers').click(); await settle();
  button('New analyzer').click(); await settle();
  starts('Build your own rules').click(); await settle();
  const name = target.querySelector('[aria-label="Analyzer name"]');
  name.value = 'Cleared ground'; name.dispatchEvent(new Event('input', { bubbles: true })); await settle();
  tab('Checks').click(); await settle();

  starts('Add a check').click(); await settle();
  expect(target.textContent).toContain('Check 1');
  expect(target.textContent).toContain('None yet: until it has pins, this check is where the map is.');
  // a check still being placed follows the map, and keeps the analyzer from being saved half made
  expect(button('Add to my analyzers').disabled).toBe(true);
  expect(target.textContent).toContain('“Check 1” needs its passes.');
  view = { west: 139.6, south: 35.6, east: 139.7, north: 35.7 };
  props.mapView = { lat: 35.65, lon: 139.65, zoom: 13 }; await settle();

  // its dates are the passes picked now
  button('Find passes').click(); await settle();
  expect(post).toHaveBeenCalledWith('/api/satellite/sentinel/acquisitions', expect.objectContaining({
    zones: [expect.objectContaining({ points: expect.arrayContaining([[139.6, 35.7]]) })] }));
  target.querySelector('[aria-label="Use 2026-05-04"] button').click(); await settle();
  target.querySelectorAll('[aria-label="Use 2026-05-11"] button')[1].click(); await settle();
  expect(target.textContent).toContain('A 2026-05-04 → B 2026-05-11');

  // arm a pin, and each click on the map drops one
  button('Should be found').click(); await settle();
  expect(button('Should be found').getAttribute('aria-pressed')).toBe('true');
  live.pinAt({ lon: 139.65, lat: 35.65 }); await settle();
  button('Should stay empty').click(); await settle();
  live.pinAt({ lon: 139.62, lat: 35.66 }); await settle();
  live.pinAt({ lon: 139.68, lat: 35.62 }); await settle();
  expect([...target.querySelectorAll('.marks li')].map((li) => li.textContent.trim())).toEqual(
    ['Should be found', 'Should stay empty', 'Should stay empty']);
  labelled('Remove pin 3').click(); await settle();
  button('Done').click(); await settle();
  expect(target.querySelector('.editor')).toBe(null);
  live.pinAt({ lon: 139.66, lat: 35.66 }); await settle();       // no check open: the click drops nothing

  button('Add to my analyzers').click(); await settle();
  const saved = post.mock.calls.find(([path]) => path === '/api/compare/analyzers')[1];
  expect(saved.checks).toEqual([expect.objectContaining({ name: 'Check 1',
    a: expect.objectContaining({ date: '2026-05-04' }), b: expect.objectContaining({ date: '2026-05-11' }),
    bounds: expect.objectContaining({ west: 139.6, east: 139.7 }),
    marks: [{ point: [139.65, 35.65], expect: 'found' }, { point: [139.62, 35.66], expect: 'empty' }] })]);
});

it('opens the reading card anywhere, and a point far off the open check starts a check of its own', async () => {
  answer({ '/api/compare/analyzers': rulesCatalogue() });
  copernicus();
  await openBuilder();
  // nothing picked yet: the card still opens and says why nothing is read
  await live.probeAt({ lon: 2.01, lat: 48.01 }); await settle();
  await readTheView();
  await live.probeAt({ lon: 2.01, lat: 48.01 }); await settle();
  live.markProbe('found'); await settle();
  expect(target.textContent).toContain('Check 1');
  await live.probeAt({ lon: 2.4, lat: 48.4 }); await settle();
  live.markProbe('empty'); await settle();
  expect(target.textContent).toContain('Check 2');
});

it('shows the passes in any Copernicus layer, and suggests the one that reads rule ★', async () => {
  answer({ '/api/compare/analyzers': rulesCatalogue() });
  copernicus();
  const onshow = vi.fn();
  await openBuilder({ onshow, passLayers: [{ id: 'TRUE_COLOR', label: 'True colour' }, { id: 'SWIR', label: 'SWIR' }, { id: 'NDVI', label: 'NDVI' }] });
  button('Find passes').click(); await settle();
  target.querySelector('[aria-label="Use 2026-05-11"] button:nth-child(2)').click(); await settle();
  expect(onshow).toHaveBeenLastCalledWith(expect.objectContaining({ date: '2026-05-11', layer: 'TRUE_COLOR' }));
  const layer = target.querySelector('[aria-label="Copernicus layer"]');
  layer.value = 'SWIR'; layer.dispatchEvent(new Event('change', { bubbles: true })); await settle();
  expect(onshow).toHaveBeenLastCalledWith(expect.objectContaining({ date: '2026-05-11', layer: 'SWIR' }));
  starts('Show it in NDVI').click(); await settle();
  expect(onshow).toHaveBeenLastCalledWith(expect.objectContaining({ layer: 'NDVI' }));
  expect(starts('Show it in')).toBeUndefined();
});

it('adds, ranks, rewrites and removes rules, and the sentence follows', async () => {
  answer({ '/api/compare/analyzers': rulesCatalogue() });
  await openBuilder();
  button('Add a rule').click(); await settle();
  expect(phrase()).toBe('Keeps ground where NDVI dropped by 0.25 or more and NDVI on B at least 0.40, outside cloud.');
  button('any').click(); await settle();
  expect(phrase()).toContain('or NDVI on B at least 0.40');
  labelled('Rank candidates by rule 2').click(); await settle();
  expect(phrase()).toMatch(/^Keeps ground where NDVI on B at least 0.40 or NDVI dropped/);
  const measure = target.querySelector('[aria-label="Rule 2 measures"]');
  measure.value = 'band'; measure.dispatchEvent(new Event('change', { bubbles: true })); await settle();
  expect(phrase()).toContain('B08 (near infrared) moved by 5.0% or more either way');
  labelled('Remove rule 1').click(); await settle();
  expect(phrase()).toBe('Keeps ground where B08 (near infrared) moved by 5.0% or more either way, outside cloud.');
  expect(labelled('Remove rule 1')).toBe(null);          // the last rule stays
  // size, description and label live under Settings
  tab('Settings').click(); await settle();
  expect(target.textContent).toContain('Size and grouping');
  expect(target.querySelector('textarea').placeholder).toBe(phrase());
});

it('opens a calibrated index built-in as the rules it applies', async () => {
  const asRules = { id: 'custom', name: 'Any surface change (rules)', description: '', phenomenon: 'Surface change',
    method: 'rules', colour: '#f6a81a', style: 'both', parameters: { ...recipe.parameters, shape: 'any' }, match: 'all',
    rules: [rule({ value: -0.27 })], checks: [] };
  answer({ '/api/compare/analyzers': rulesCatalogue({ as_rules: { 'large-change': asRules } }) });
  await open({ viewBounds: () => VIEW });
  labelled('Analyzers').click(); await settle();
  button('New analyzer').click(); await settle();
  labelled('Open Any surface change as rules').click(); await settle();
  expect(heading()).toBe('Build an analyzer');
  expect(target.querySelector('[aria-label="Analyzer name"]').value).toBe('Any surface change (rules)');
  expect(phrase()).toBe('Keeps ground where NBR dropped by 0.27 or more, outside cloud.');
});

it('opens an analyzer kept from Compare straight in the builder, with no case open', async () => {
  const own = { ...structuredClone(recipe), id: 'custom-aaaaaaaaaaaa', name: 'NBR: Burnt', method: 'rules', match: 'all',
    rules: [rule({ value: -0.3 })] };
  answer({ '/api/compare/analyzers': rulesCatalogue({ custom: [own] }) });
  await open({ caseId: null, opening: 'analyzer:custom-aaaaaaaaaaaa', viewBounds: () => VIEW });
  expect(heading()).toBe('Edit NBR: Burnt');
  expect(button('Save changes')).toBeDefined();
});

it('says in the library how an analyzer’s checks last came out', async () => {
  const own = { ...EXAMPLE.recipe, id: 'custom-bbbbbbbbbbbb' };
  answer({ '/api/compare/analyzers': rulesCatalogue({ custom: [own] }) });
  await open();
  labelled('Analyzers').click(); await settle();
  expect(target.textContent).toContain('2 checks · not run');
});

// -- review --------------------------------------------------------------------------

it('offers three verdicts, and only the pin reaches the case', async () => {
  const row = (id, lon, strength, value) => ({ id, coordinates: [lon, 48], bbox: [lon, 48, lon + 0.001, 48.001],
    area: 90, margin: 2, strength, measure: { value }, review: 'new',
    phenomenon: 'Surface change', parts: [{ frames: ['a', 'b'], box: [0, 0, 4, 4] }] });
  const saved = { id: RUN, title: 'Harbour sweep', status: 'ready', progress: 1, total: 1,
    count: 2, engine_version: 2, results: [row('0-1', 2, 'strong', 12.34), row('0-2', 2.002, 'weak', 8)],
    input: { title: 'Harbour sweep', zones: area, recipe: structuredClone(recipe), note: '',
      a: { provider: 'sentinel2', date: '2026-05-04' }, b: { provider: 'sentinel2', date: '2026-05-11' },
      offline: false, date_rule: 'manual', followup_id: null } };
  answer({ [`/api/cases/case-a/analysis/runs/${RUN}`]: saved });
  patch.mockImplementation(async (_, body) => ({ ...saved.results[0], ...body }));
  post.mockImplementation(async () => ({ entity: { id: 'e1', type: 'place' },
    result: { ...saved.results[1], review: 'kept', entity_id: 'e1' } }));
  await open({ opening: `runs-${RUN}` });
  expect(target.textContent).toContain('1 of 2');
  expect(target.textContent).toContain('Strong · Reflectance moved by 12.3%');
  expect(target.textContent).toContain('Keep stays in this run. Pin creates a place and evidence in Files.');

  // kept here: no pin, no entity, and it stays among what the detection holds
  button('Keep').click(); await settle();
  expect(patch).toHaveBeenCalledWith(`/api/cases/case-a/analysis/runs/${RUN}/results/0-1`, { review: 'noted' });
  expect(post).not.toHaveBeenCalled();
  expect(target.textContent).toContain('2 of 2');

  button('Pin').click(); await settle();
  expect(document.querySelector('[role="dialog"][aria-label="Pin candidate"]')).not.toBe(null);
  expect(post).not.toHaveBeenCalled();
  expect(document.querySelector('[value="area"]').checked).toBe(true);
  button('Save pin').click(); await settle();
  expect(post).toHaveBeenCalledWith(`/api/cases/case-a/analysis/runs/${RUN}/results/0-2/promote`,
    { title: 'Surface change · 48.0000, 2.0020', description: '', after_only: false, shape: 'area' });
  expect(target.textContent).toContain('Kept as a pin in this case');
  expect(target.textContent).toContain('1 pinned, 1 kept here');
});

it('walks the queue from the keys, and narrows it to what is still to review', async () => {
  const row = (id, lon, review) => ({ id, coordinates: [lon, 48], bbox: [lon, 48, lon + 0.001, 48.001],
    area: 90, margin: 2, strength: 'strong', measure: { value: 3 }, review,
    phenomenon: 'Surface change', parts: [{ frames: ['a', 'b'], box: [0, 0, 4, 4] }] });
  const saved = { id: RUN, title: 'Harbour sweep', status: 'ready', progress: 1, total: 1,
    count: 3, engine_version: 2,
    results: [row('0-1', 2, 'new'), row('0-2', 2.002, 'noted'), row('0-3', 2.004, 'new')],
    input: { title: 'Harbour sweep', zones: area, recipe: structuredClone(recipe), note: '',
      a: { provider: 'sentinel2', date: '2026-05-04' }, b: { provider: 'sentinel2', date: '2026-05-11' },
      offline: false, date_rule: 'manual', followup_id: null } };
  answer({ [`/api/cases/case-a/analysis/runs/${RUN}`]: saved });
  patch.mockImplementation(async (_, body) => ({ ...saved.results[0], ...body }));
  const onfocus = vi.fn();
  await open({ opening: `runs-${RUN}`, onfocus });

  // Opening a run puts the map on the candidate the panel is about, close
  // enough to read: judging what you cannot see is guesswork.
  expect(onfocus).toHaveBeenCalledWith([2, 48], 16);

  // The arrows walk it…
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  await settle();
  expect(target.textContent).toContain('2 of 3');
  // …and the verdicts are one key each, on a candidate that still wants one.
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  await settle();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true }));
  await settle();
  expect(patch).toHaveBeenCalledWith(`/api/cases/case-a/analysis/runs/${RUN}/results/0-3`, { review: 'noted' });

  // The crops are small in a narrow column, so the same picture opens big.
  labelled('Enlarge the evidence').click(); await settle();
  expect(document.querySelector('[role="dialog"] img.big')).not.toBe(null);
  document.querySelector('[role="dialog"] button[aria-label="Close"]').click(); await settle();

  // A hundred candidates are worked in passes, so the queue narrows.
  button('To review 1').click(); await settle();
  expect(target.textContent).toContain('1 of 1');
});

it('says how long a hull is, and walks the largest first when asked', async () => {
  // Cells of 0.0001°, 7.4 m east to west and 11 m north to south at 48° N: a skiff of one,
  // and a ship of twenty lying east to west.
  const step = 0.0001;
  const hull = (count) => ({ type: 'Polygon', coordinates: [[[2, 48], [2 + count * step, 48],
    [2 + count * step, 48 + step], [2, 48 + step], [2, 48]]] });
  const row = (id, count, strength) => ({ id, coordinates: [2, 48], bbox: [2, 48, 2 + count * step, 48 + step],
    geometry: hull(count), area: count * 55, margin: 2, strength, measure: { value: 3 }, review: 'new',
    phenomenon: 'Vessel candidate', parts: [{ frames: ['b'], box: [0, 0, 4, 4] }] });
  const saved = { id: RUN, title: 'Harbour sweep', status: 'ready', progress: 1, total: 1, count: 2,
    engine_version: 2, results: [row('0-1', 1, 'strong'), row('0-2', 20, 'weak')],
    input: { title: 'Harbour sweep', zones: area, recipe: structuredClone(vessels), note: '',
      a: { provider: 'sentinel2', date: '2026-05-11' }, b: { provider: 'sentinel2', date: '2026-05-11' },
      offline: false, date_rule: 'manual', followup_id: null } };
  answer({ [`/api/cases/case-a/analysis/runs/${RUN}`]: saved });
  await open({ opening: `runs-${RUN}` });
  // strongest first, as the run lists it: the skiff, long side first
  expect(target.textContent).toContain('1 of 2');
  expect(target.textContent).toContain('55 m² · ≈ 11 m long, 7.4 m wide');
  button('Largest first').click(); await settle();
  expect(button('Largest first').getAttribute('aria-pressed')).toBe('true');
  // the ship comes up first, measured along its hull
  expect(target.textContent).toContain('1 of 2');
  expect(target.textContent).toContain('≈ 149 m long, 11 m wide');
  // and back to the run's own order, from its top
  button('Largest first').click(); await settle();
  expect(target.textContent).toContain('≈ 11 m long, 7.4 m wide');
});

it('adds a candidate where the map was right-clicked, inside an area the run read', async () => {
  const saved = { id: RUN, title: 'Harbour sweep', status: 'ready', progress: 1, total: 1, count: 0,
    engine_version: 2, results: [],
    area_runs: [{ area_id: 'area', status: 'ready', b: { provider: 'sentinel2', date: '2026-05-11' } }],
    input: { title: 'Harbour sweep', zones: area, recipe: structuredClone(vessels), note: '',
      a: { provider: 'sentinel2', date: '2026-05-11' }, b: { provider: 'sentinel2', date: '2026-05-11' },
      offline: false, date_rule: 'manual', followup_id: null } };
  // not while the list is up: there is no run to add it to
  answer({ [`/api/cases/case-a/analysis/runs/${RUN}`]: saved });
  await open();
  expect(live.candidateAreaAt({ lat: 48.0005, lon: 2.0005 })).toBe(null);
  unmount(live);
  await open({ opening: `runs-${RUN}` });
  expect(live.candidateAreaAt({ lat: 48.0005, lon: 2.0005 })).toBe('area');
  expect(live.candidateAreaAt({ lat: 48.01, lon: 2.0005 })).toBe(null);
  post.mockImplementation(async (_, body) => ({ id: 'manual-1', origin: 'manual', area_id: body.area_id,
    geometry: body.geometry, coordinates: body.geometry.coordinates, bbox: [2, 48, 2.0001, 48.0001],
    area: 55, margin: 0, measure: {}, review: 'new', phenomenon: 'Manual candidate', parts: [] }));
  await live.addCandidate('area', { type: 'Point', coordinates: [2.0005, 48.0005] }); await settle();
  expect(post).toHaveBeenCalledWith(`/api/cases/case-a/analysis/runs/${RUN}/results`,
    { area_id: 'area', geometry: { type: 'Point', coordinates: [2.0005, 48.0005] } });
  expect(target.textContent).toContain('Manual candidate · Manual');
});

it('reopens a run saved against Wayback without pretending it had a Sentinel-2 date', async () => {
  const old = { id: 'aaaaaaaaaaaa', title: 'Old harbour', status: 'ready', progress: 1, total: 1, count: 0,
    engine_version: 1, results: [],
    input: { title: 'Old harbour', zones: area, recipe: { ...structuredClone(recipe), method: 'colour' },
      a: { provider: 'esri-wayback', release: 1 }, b: { provider: 'esri-wayback', release: 2 },
      offline: false, date_rule: 'manual', followup_id: null } };
  answer({ '/api/cases/case-a/analysis/runs/aaaaaaaaaaaa': old });
  await open({ opening: 'runs-aaaaaaaaaaaa' });
  expect(target.textContent).toContain('Wayback release 1 → Wayback release 2');
  button('Edit and rerun').click(); await settle();
  expect(heading()).toBe('Where to look');
  button('Next: What').click(); await settle();
  button('Next: When').click(); await settle();
  expect(target.textContent).toContain('Choose A, the picture before.');
  expect(button('Next: Start').disabled).toBe(true);
});

// -- radar and the second look ---------------------------------------------------------

it('opens a candidate in Compare on the passes that found it', async () => {
  const { uiState } = await import('../../lib/state.svelte.js');
  const row = { id: '0-1', coordinates: [2, 48], bbox: [2, 48, 2.001, 48.001], area: 90,
    margin: 2, strength: 'strong', measure: { value: 3 }, review: 'new', phenomenon: 'Surface change',
    parts: [{ frames: ['a', 'b'], box: [0, 0, 4, 4] }],
    sources: { a: { provider: 'sentinel2', date: '2026-05-04' }, b: { provider: 'sentinel2', date: '2026-05-11' } } };
  const saved = { id: RUN, title: 'Harbour sweep', status: 'ready', progress: 1, total: 1, count: 1,
    engine_version: 2, results: [row],
    input: { title: 'Harbour sweep', zones: area, recipe: structuredClone(recipe), note: '',
      a: { provider: 'sentinel2', date: '2026-05-04' }, b: { provider: 'sentinel2', date: '2026-05-11' },
      offline: false, date_rule: 'manual', followup_id: null } };
  answer({ [`/api/cases/case-a/analysis/runs/${RUN}`]: saved });
  await open({ opening: `runs-${RUN}` });
  button('Compare').click(); await settle();
  expect(uiState.tool).toBe('compare');
  expect(uiState.compareAt).toMatchObject({ lat: 48, lon: 2, zoom: 16, dates: ['2026-05-04', '2026-05-11'] });
  // nothing is asked of Copernicus to decide it: the candidate names its passes
  expect(post).not.toHaveBeenCalled();
});

it('says a radar analyzer needs its layer before a detection is built on it', async () => {
  const radar = { ...structuredClone(recipe), id: 'radar-vessels', name: 'Vessels by radar',
    method: 'sar-vessels', phenomenon: 'Vessel candidate (radar)' };
  const radarMethod = { id: 'sar-vessels', label: 'Radar', single: true, clouds: false, sensor: 'sentinel1',
    frames: 3, sizes, measure: '{value} dB brighter than the sea around it' };
  const table = { '/api/cases/case-a/analysis/zones/aaaaaaaaaaaa': { id: 'aaaaaaaaaaaa', title: 'Port', zones: area } };
  get.mockImplementation(async (path) => (path === '/api/compare/analyzers'
    ? catalogue({ builtins: [radar], methods: [...methods, radarMethod], radar_layer: '' })
    : path in table ? structuredClone(table[path]) : []));
  await open({ opening: 'zones-aaaaaaaaaaaa' });
  // the water it is judged against is one more request a tile
  expect(target.textContent).toContain('1 tile · 3 requests a run');
  button('Next: What').click(); await settle();
  expect(target.textContent).toContain('not set up yet');
  expect(button('How to add it, in Settings → Imagery')).toBeDefined();
  expect(button('Next: When').disabled).toBe(true);
});

it('lists the analyzers by what they look for, each saying how far it can be trusted', async () => {
  const radar = { ...structuredClone(recipe), id: 'radar-vessels', name: 'Vessels by radar', method: 'sar-vessels' };
  const radarMethod = { id: 'sar-vessels', label: 'Radar', single: true, clouds: false, sensor: 'sentinel1',
    frames: 3, sizes, measure: '{value} dB' };
  const table = { '/api/cases/case-a/analysis/zones/aaaaaaaaaaaa': { id: 'aaaaaaaaaaaa', title: 'Port', zones: area } };
  get.mockImplementation(async (path) => (path === '/api/compare/analyzers'
    ? catalogue({ builtins: [structuredClone(vessels), radar, structuredClone(recipe)],
      methods: [...methods, radarMethod], radar_layer: '', copernicus_key: true,
      groups: [{ id: 'vessels', label: 'Vessels', recipes: ['radar-vessels', 'boats'] },
        { id: 'any', label: 'Any change', recipes: ['large-change'] }],
      reliability: { 'radar-vessels': 'reliable', boats: 'approximate', 'large-change': 'rough' } })
    : path in table ? structuredClone(table[path]) : []));
  await open({ opening: 'zones-aaaaaaaaaaaa' });
  button('Next: What').click(); await settle();
  const groups = [...target.querySelectorAll('.choices .group')].map((node) => node.textContent);
  expect(groups).toEqual(['Vessels', 'Any change']);
  const radarRow = [...target.querySelectorAll('.choice')].find((node) => node.textContent.includes('Vessels by radar'));
  expect(radarRow.textContent).toContain('(reliable)');
  expect(radarRow.textContent).toContain('set up');
  expect(radarRow.getAttribute('title')).toBe('Needs the Sentinel-1 layer');
  expect(target.textContent).toContain('(rough)');
});
