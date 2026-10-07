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
/** Every category of analyzers starts folded; open them all. */
async function unfold() {
  target.querySelectorAll('.fold[aria-expanded="false"]').forEach((fold) => fold.click());
  await settle();
}
/** Nothing is picked in What until asked: open the category holding an analyzer, then pick it. */
async function pickAnalyzer(name = recipe.name) {
  const radio = () => [...target.querySelectorAll('[role="radio"]')].find((b) => b.textContent.includes(name));
  if (!radio()) await unfold();
  radio().click(); await settle();
}
const ceilingSlider = () => target.querySelector('input[aria-label="Maximum cloud cover"]');
function slide(value) {
  const slider = ceilingSlider();
  slider.value = String(value);
  slider.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}
async function typeWhenDay(buttonLabel, fieldLabel, value) {
  labelled(buttonLabel).click(); await settle();
  const details = target.querySelector('.manual-date');
  if (!details.open) { details.querySelector('summary').click(); await settle(); }
  const field = target.querySelector(`[aria-label="${fieldLabel}"]`);
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  await settle();
}

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
  expect(target.querySelector('[aria-label="Dates for Area"]')).not.toBe(null);
  button('Check for new passes').click(); await settle();
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

it('changes a saved routine colour from its square without folding the group', async () => {
  let current = watchRow({ colour: '#38bdf8' });
  const body = watchBody();
  get.mockImplementation(async (path) => {
    if (path === '/api/compare/analyzers') return catalogue();
    if (path === `/api/cases/case-a/analysis/followups/${WATCH}`) return structuredClone(body);
    if (path.endsWith('/followups')) return [structuredClone(current)];
    if (path.endsWith('/runs')) return [runRow()];
    return [];
  });
  patch.mockImplementation(async (_, payload) => {
    current = { ...current, colour: payload.colour };
    return payload;
  });
  await open();
  button('Saved').click(); await settle();
  const picker = target.querySelector('input[aria-label="Colour of Harbour weekly"]');
  expect(picker.value).toBe('#38bdf8');
  picker.value = '#22d3ee';
  picker.dispatchEvent(new Event('change', { bubbles: true })); await settle();
  expect(patch).toHaveBeenCalledWith(`/api/cases/case-a/analysis/followups/${WATCH}/colour`,
    { colour: '#22d3ee' });
  expect(target.querySelector('input[aria-label="Colour of Harbour weekly"]').value).toBe('#22d3ee');
  expect(target.querySelector('.fold[aria-expanded="true"]')).not.toBe(null);
});

it('changes a one pass colour without changing its recorded analyzer', async () => {
  let once = runRow({ title: 'Port sweep', followup_id: null, colour: '#f6a81a' });
  get.mockImplementation(async (path) => {
    if (path === '/api/compare/analyzers') return catalogue();
    if (path.endsWith('/runs')) return [structuredClone(once)];
    return [];
  });
  patch.mockImplementation(async (_, payload) => {
    once = { ...once, colour: payload.colour };
    return { display_colour: payload.colour };
  });
  await open();
  button('Saved').click(); await settle();
  const picker = target.querySelector('input[aria-label="Colour of Port sweep"]');
  expect(picker.value).toBe('#f6a81a');
  picker.value = '#eab308';
  picker.dispatchEvent(new Event('change', { bubbles: true })); await settle();
  expect(patch).toHaveBeenCalledWith(`/api/cases/case-a/analysis/runs/${RUN}/colour`,
    { colour: '#eab308' });
  expect(target.querySelector('input[aria-label="Colour of Port sweep"]').value).toBe('#eab308');
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

it('shows shared groups and ungrouped areas in Where without selecting an area twice', async () => {
  const ring = [[2, 48], [2.01, 48], [2.01, 48.01], [2, 48.01], [2, 48]];
  const harbor = { id: 'aaaaaaaaaaaa', name: 'Harbor', colour: '#38bdf8',
    geometry: { type: 'Polygon', coordinates: [ring] } };
  const river = { ...harbor, id: 'bbbbbbbbbbbb', name: 'River' };
  answer({
    '/api/cases/case-a/analysis/areas': [harbor, river],
    '/api/cases/case-a/analysis/zones': [
      { id: '111111111111', title: 'Ports', area_ids: [harbor.id], position: 0 },
      { id: '222222222222', title: 'Priority', area_ids: [harbor.id], position: 1 },
    ],
  });
  post.mockResolvedValue({ id: '333333333333' });
  await open();
  button('New detection').click(); await settle();
  labelled('New one pass').click(); await settle();
  const where = target.querySelector('[aria-label="Where to look"]');
  expect(where.textContent).toContain('Ungrouped');
  expect(where.textContent).toContain('River');
  labelled('Use Ports').click(); await settle();
  // Harbor is all of Priority too, so that group reads as ticked, and unticking it takes Harbor out
  expect(labelled('Use Priority').getAttribute('aria-checked')).toBe('true');
  expect(where.querySelectorAll('.area-row')).toHaveLength(1);
  labelled('Use Priority').click(); await settle();
  expect(where.querySelectorAll('.area-row')).toHaveLength(0);
  expect(labelled('Use Ports').getAttribute('aria-checked')).toBe('false');
  labelled('Use Ports').click(); await settle();
  const search = where.querySelector('[aria-label="Search areas or groups"]');
  search.value = 'River'; search.dispatchEvent(new Event('input', { bubbles: true })); await settle();
  expect(where.textContent).not.toContain('Ports');
  expect(where.textContent).toContain('River');
  search.value = ''; search.dispatchEvent(new Event('input', { bubbles: true })); await settle();
  button('River').click(); await settle();
  expect(where.querySelectorAll('.area-row')).toHaveLength(2);
  [...where.querySelectorAll('summary')].find((node) => node.textContent === 'Save selection as group').click();
  const name = where.querySelector('[aria-label="Group name"]');
  name.value = 'My sweep'; name.dispatchEvent(new Event('input', { bubbles: true })); await settle();
  button('Save group').click(); await settle();
  expect(post).toHaveBeenCalledWith('/api/cases/case-a/analysis/zones', {
    title: 'My sweep', area_ids: [harbor.id, river.id],
  });
});

it('asks which shape a migrated group should use before offering it in Where', async () => {
  const ring = [[2, 48], [2.01, 48], [2.01, 48.01], [2, 48.01], [2, 48]];
  const current = { id: 'aaaaaaaaaaaa', name: 'Harbor', colour: '#38bdf8',
    geometry: { type: 'Polygon', coordinates: [ring] } };
  const saved = { ...current, id: 'bbbbbbbbbbbb', name: 'Harbor saved shape' };
  const review = { saved_area_id: saved.id, current_area_id: current.id, name: 'Harbor' };
  answer({
    '/api/cases/case-a/analysis/areas': [current, saved],
    '/api/cases/case-a/analysis/zones': [
      { id: '111111111111', title: 'Ports', area_ids: [saved.id], position: 0, pending_review: [review] },
    ],
  });
  put.mockResolvedValue({});
  const onframe = vi.fn();
  await open({ onframe });
  button('New detection').click(); await settle();
  labelled('New one pass').click(); await settle();
  expect(labelled('Use Ports').disabled).toBe(true);
  button('Review saved shapes in Areas').click(); await settle();
  expect(target.textContent).toContain('Choose which shape this group should use.');
  button('Show saved').click(); await settle();
  expect(onframe).toHaveBeenCalledWith([{ kind: 'polygon', points: ring }]);
  button('Use current').click(); await settle();
  expect(put).toHaveBeenCalledWith('/api/cases/case-a/analysis/zones/111111111111', {
    title: 'Ports', area_ids: [current.id], position: 0, pending_review: [],
  });
  expect(del).not.toHaveBeenCalled();
});

it('reorders groups and adds an area to another group without copying it', async () => {
  const ring = [[2, 48], [2.01, 48], [2.01, 48.01], [2, 48.01], [2, 48]];
  const harbor = { id: 'aaaaaaaaaaaa', name: 'Harbor', colour: '#38bdf8',
    geometry: { type: 'Polygon', coordinates: [ring] } };
  answer({
    '/api/cases/case-a/analysis/areas': [harbor],
    '/api/cases/case-a/analysis/zones': [
      { id: '111111111111', title: 'Ports', area_ids: [harbor.id], position: 0 },
      { id: '222222222222', title: 'Priority', area_ids: [], position: 1 },
    ],
  });
  put.mockResolvedValue({});
  await open();
  button('Areas').click(); await settle();
  starts('Ports').click(); await settle();
  const add = target.querySelector('[aria-label="Add Harbor to group"]');
  add.value = '222222222222'; add.dispatchEvent(new Event('change', { bubbles: true })); await settle();
  expect(put).toHaveBeenCalledWith('/api/cases/case-a/analysis/zones/222222222222',
    { title: 'Priority', area_ids: [harbor.id], position: 1, pending_review: [] });
  expect(put).not.toHaveBeenCalledWith('/api/cases/case-a/analysis/areas/aaaaaaaaaaaa', expect.anything());

  const drag = labelled('Drag group Ports');
  const event = new Event('dragstart', { bubbles: true });
  Object.defineProperty(event, 'dataTransfer', { value: { setData: () => {}, effectAllowed: '' } });
  drag.dispatchEvent(event);
  const priorityHead = target.querySelector('[aria-label="Drop into Priority"]');
  priorityHead.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }));
  await settle();
  expect(priorityHead.classList.contains('landing-after')).toBe(true);
  priorityHead.dispatchEvent(new Event('drop', { bubbles: true }));
  await settle();
  expect(priorityHead.classList.contains('landing-after')).toBe(false);
  expect(put).toHaveBeenCalledWith('/api/cases/case-a/analysis/zones/111111111111',
    { title: 'Ports', area_ids: [harbor.id], position: 1, pending_review: [] });

  const areaDrag = new Event('dragstart', { bubbles: true });
  Object.defineProperty(areaDrag, 'dataTransfer', { value: { setData: () => {}, effectAllowed: '' } });
  labelled('Drag Harbor').dispatchEvent(areaDrag);
  priorityHead.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }));
  await settle();
  expect(priorityHead.classList.contains('landing-area')).toBe(true);
  priorityHead.dispatchEvent(new Event('drop', { bubbles: true }));
  await settle();
  expect(priorityHead.classList.contains('landing-area')).toBe(false);
  expect(put).toHaveBeenCalledWith('/api/cases/case-a/analysis/zones/111111111111',
    { title: 'Ports', area_ids: [], position: 0, pending_review: [] });
  expect(put).toHaveBeenCalledWith('/api/cases/case-a/analysis/zones/222222222222',
    { title: 'Priority', area_ids: [harbor.id], position: 1, pending_review: [] });
});

it('orders ungrouped areas and creates an empty group in Areas', async () => {
  const ring = [[2, 48], [2.01, 48], [2.01, 48.01], [2, 48.01], [2, 48]];
  const harbor = { id: 'aaaaaaaaaaaa', name: 'Harbor', colour: '#38bdf8',
    geometry: { type: 'Polygon', coordinates: [ring] } };
  const river = { ...harbor, id: 'bbbbbbbbbbbb', name: 'River' };
  answer({ '/api/cases/case-a/analysis/areas': [harbor, river] });
  put.mockResolvedValue({});
  post.mockResolvedValue({ id: '111111111111' });
  await open();
  button('Areas').click(); await settle();
  const drag = new Event('dragstart', { bubbles: true });
  Object.defineProperty(drag, 'dataTransfer', { value: { setData: () => {}, effectAllowed: '' } });
  labelled('Drag River').dispatchEvent(drag);
  const harborRow = target.querySelector('[role="group"][aria-label="Harbor"]');
  harborRow.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }));
  await settle();
  expect(harborRow.classList.contains('landing-before')).toBe(true);
  harborRow.dispatchEvent(new Event('drop', { bubbles: true }));
  await settle();
  expect(harborRow.classList.contains('landing-before')).toBe(false);
  expect(put).toHaveBeenCalledWith('/api/cases/case-a/analysis/areas/bbbbbbbbbbbb',
    expect.objectContaining({ position: 0 }));
  button('New group').click(); await settle();
  const name = target.querySelector('[aria-label="New group name"]');
  name.value = 'Ports'; name.dispatchEvent(new Event('input', { bubbles: true })); await settle();
  button('Create').click(); await settle();
  expect(post).toHaveBeenCalledWith('/api/cases/case-a/analysis/zones',
    { title: 'Ports', area_ids: [] });
});

it('searches the routines once there are more than five', async () => {
  const names = ['Harbour weekly', 'Airbase apron', 'Río crossing', 'Depot north', 'Quarry', 'Border road'];
  const rows = names.map((title, i) => watchRow({ id: `abcdef12345${i}`, title, note: '' }));
  answer({ '/api/cases/case-a/analysis/followups': rows.slice(0, 5) });
  await open();
  expect(target.querySelector('[aria-label="Search routines…"]')).toBe(null);
  unmount(live);
  answer({ '/api/cases/case-a/analysis/followups': rows });
  await open();
  const search = target.querySelector('[aria-label="Search routines…"]');
  const shown = () => [...target.querySelectorAll('.card .title')].map((node) => node.textContent.trim());
  expect(shown()).toHaveLength(6);
  search.value = 'rio'; search.dispatchEvent(new Event('input', { bubbles: true })); await settle();
  expect(shown()).toEqual(['Río crossing']);
  expect(target.textContent).toContain('1/6');
  search.value = 'nowhere'; search.dispatchEvent(new Event('input', { bubbles: true })); await settle();
  expect(shown()).toEqual([]);
  expect(target.textContent).toContain('No routine matches “nowhere”.');
});

it('starts every area group folded, hides a whole group at once, and shuts a menu on a press elsewhere', async () => {
  const ring = [[2, 48], [2.01, 48], [2.01, 48.01], [2, 48.01], [2, 48]];
  const harbor = { id: 'aaaaaaaaaaaa', name: 'Harbor', colour: '#38bdf8',
    geometry: { type: 'Polygon', coordinates: [ring] } };
  const quay = { ...harbor, id: 'bbbbbbbbbbbb', name: 'Quay' };
  const river = { ...harbor, id: 'cccccccccccc', name: 'River' };
  answer({
    '/api/cases/case-a/analysis/areas': [harbor, quay, river],
    '/api/cases/case-a/analysis/zones': [
      { id: '111111111111', title: 'Ports', area_ids: [harbor.id, quay.id], position: 0 },
      { id: '222222222222', title: 'Rivers', area_ids: [river.id], position: 1 },
    ],
  });
  await open();
  button('Areas').click(); await settle();
  // the first group used to open by itself
  expect([...target.querySelectorAll('.fold')].map((fold) => fold.getAttribute('aria-expanded')))
    .toEqual(['false', 'false']);
  expect(labelled('Hide Harbor')).toBe(null);

  labelled('Hide group Ports').click(); await settle();
  expect(labelled('Show group Ports')).not.toBe(null);
  starts('Ports').click(); await settle();
  expect(labelled('Show Harbor')).not.toBe(null);
  expect(labelled('Show Quay')).not.toBe(null);
  // one area back on the map makes the group read as shown, and its eye hides it again
  labelled('Show Quay').click(); await settle();
  expect(labelled('Hide group Ports')).not.toBe(null);
  labelled('Hide group Ports').click(); await settle();
  expect(labelled('Show Quay')).not.toBe(null);
  labelled('Show group Ports').click(); await settle();
  expect(labelled('Hide Harbor')).not.toBe(null);
  expect(labelled('Hide Quay')).not.toBe(null);

  const menu = (name) => target.querySelector(`summary[aria-label="More actions for ${name}"]`).parentElement;
  const toggle = async (details) => { details.open = !details.open; details.dispatchEvent(new Event('toggle')); await settle(); };
  await toggle(menu('Harbor'));
  // a second menu shuts the first
  await toggle(menu('Quay'));
  expect(menu('Harbor').open).toBe(false);
  expect(menu('Quay').open).toBe(true);
  target.querySelector('[aria-label="Search areas or groups"]').dispatchEvent(new Event('pointerdown', { bubbles: true }));
  await settle();
  expect(menu('Quay').open).toBe(false);

  // and the areas step of a new detection folds them the same way
  button('New detection').click(); await settle();
  labelled('New one pass').click(); await settle();
  const where = target.querySelector('[aria-label="Where to look"]');
  expect([...where.querySelectorAll('.group-fold')].map((fold) => fold.getAttribute('aria-expanded')))
    .toEqual(['false', 'false']);
  expect(where.textContent).not.toContain('Harbor');
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
  button('Check for new passes').click(); await settle();
  expect(post).toHaveBeenCalledWith(`/api/cases/case-a/analysis/followups/${WATCH}/run`, { area_dates: [expect.objectContaining({ b: expect.objectContaining({ date: '2026-09-16' }) })] });
});

it('shows the last pass per area and leaves a current routine unqueued', async () => {
  const second = { ...area[0], id: 'second', name: 'Second area' };
  const body = watchBody({ recipe: structuredClone(recipe), zones: [...area, second], area_dates: [...area, second].map((zone) => ({
    area_id: zone.id, a: { provider: 'sentinel2', date: '2026-09-01' },
    b: { provider: 'sentinel2', date: '' }, date_rule: 'latest_previous',
  })) });
  answer({
    '/api/cases/case-a/analysis/followups': [watchRow({ zones: body.zones, areas: 2, method: 'surface' })],
    [`/api/cases/case-a/analysis/followups/${WATCH}`]: body,
    [`/api/cases/case-a/analysis/followups/${WATCH}/last-passes`]: {
      area: { provider: 'sentinel2', date: '2026-09-06' },
      second: { provider: 'sentinel2', date: '2026-09-07' },
    },
  });
  const onshow = vi.fn();
  post.mockImplementation(async (path) => path.endsWith('/acquisitions')
    ? { dates: [{ date: '2026-09-16', cloud: 4, coverage: 1 }], truncated: false }
    : { status: 'no_new_imagery', message: 'No new pass since 2026-09-07' });
  await open({ onshow });
  labelled('Run Harbour weekly').click(); await settle();
  expect(target.querySelectorAll('.area-date')).toHaveLength(2);
  expect(target.textContent).toContain('Last completed pass');
  target.querySelector('.area-date .side button.link').click(); await settle();
  expect(onshow).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-09-06', side: 'A',
    area: expect.objectContaining({ id: 'area' }) }));
  const cards = target.querySelectorAll('.area-date');
  cards[1].querySelector('button[aria-label="Date B for Second area"]').click(); await settle();
  expect(cards[1].querySelector('[aria-label="Pass for Second area pass calendar"]')).not.toBe(null);
  expect(cards[0].querySelector('.pass-calendar')).toBe(null);
  labelled('Find passes for Second area').click(); await settle();
  expect(cards[1].querySelector('.passes')).not.toBe(null);
  expect(cards[0].querySelector('.passes')).toBe(null);
  await typeWhenDay('Date B for Second area', 'Pass for Second area', '01/09/2026');
  expect(button('Check for new passes').disabled).toBe(true);
  button('Use newest').click(); await settle();
  expect(button('Check for new passes').disabled).toBe(false);
  button('Check for new passes').click(); await settle();
  expect(toast).toHaveBeenCalledWith('No new pass since 2026-09-07', 'info');
  expect(target.querySelector('.launch-body')).toBe(null);
});

it('resizes the dock through the keyboard and pointer handle', async () => {
  const onwidth = vi.fn();
  const onwidthend = vi.fn();
  await open({ dockWidth: 380, maxDockWidth: () => 720, onwidth, onwidthend });
  const handle = labelled('Resize Detect panel');
  handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
  handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  expect(onwidth.mock.calls.map(([width]) => width)).toEqual([300, 720]);
  handle.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 900, bubbles: true }));
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: 820 }));
  window.dispatchEvent(new PointerEvent('pointerup'));
  expect(onwidth).toHaveBeenLastCalledWith(460);
  expect(onwidthend).toHaveBeenCalledTimes(3);
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

it('opens a saved group from Files after loading its current shared area', async () => {
  const ring = [[2, 48], [2.01, 48], [2.01, 48.01], [2, 48.01], [2, 48]];
  const shared = { id: 'bbbbbbbbbbbb', name: 'Harbor', colour: '#38bdf8',
    geometry: { type: 'Polygon', coordinates: [ring] } };
  answer({
    '/api/cases/case-a/analysis/areas': [shared],
    '/api/cases/case-a/analysis/zones/aaaaaaaaaaaa': {
      id: 'aaaaaaaaaaaa', title: 'Ports', area_ids: [shared.id], position: 0,
    },
  });
  await open({ opening: 'zones-aaaaaaaaaaaa' });
  expect(heading()).toBe('Where to look');
  expect(target.querySelectorAll('[aria-label="Where to look"] .area-row')).toHaveLength(1);
  expect(target.textContent).toContain('Harbor');
});

it('walks a single pass through its steps and runs it once', async () => {
  answer({ '/api/cases/case-a/analysis/zones/aaaaaaaaaaaa': { id: 'aaaaaaaaaaaa', title: 'Port', zones: area } });
  post.mockResolvedValue({ id: RUN, status: 'queued', input: {}, results: [], total: 1, progress: 0 });
  await open({ opening: 'zones-aaaaaaaaaaaa' });
  expect(heading()).toBe('Where to look');
  expect(target.textContent).toContain('1 tile');
  button('Next: What').click(); await settle(); await pickAnalyzer();
  expect(heading()).toBe('What to look for');
  button('Next: When').click(); await settle();
  expect(heading()).toBe('Which two images');
  // a pair needs A, and says so in the words of the step
  expect(button('Next: Start').disabled).toBe(true);
  expect(target.textContent).toContain('Choose A, the picture before.');
  // B is the newest pass under the ceiling until a day is asked for, and the
  // button says which ceiling rather than promising the newest pass there is
  expect(labelled('Date B').textContent).toContain('Newest pass under 30% cloud');
  await typeWhenDay('Date B', 'Day of B', '06/09/2026');
  expect(target.textContent).toContain('Choose A, the picture before.');
  // the passes are listed in the step itself, and only when asked for
  expect(post.mock.calls.every(([path]) => path.endsWith('/acquisitions'))).toBe(true);
  post.mockImplementationOnce(async () => ({
    dates: [{ date: '2026-08-01', cloud: 2, granules: 1, coverage: 1 }], truncated: false }));
  button('Find passes').click(); await settle();
  expect(post).toHaveBeenCalledWith('/api/satellite/sentinel/acquisitions', expect.objectContaining({ zones: area }));
  button('A').click(); await settle();
  expect(button('Next: Start').disabled).toBe(false);
  button('Next: Start').click(); await settle();
  expect(heading()).toBe('Name and start');
  expect(target.textContent).toContain('4 requests a run');
  expect(target.textContent).toContain('2026-08-01 → 2026-09-06');
  const note = target.querySelector('[aria-label="Detection description"]');
  note.value = 'Checking the strike'; note.dispatchEvent(new Event('input', { bubbles: true }));
  button('Run this pass').click(); await settle();
  expect(post).toHaveBeenCalledWith('/api/cases/case-a/analysis/runs', expect.objectContaining({
    zones: area, date_rule: 'manual', note: 'Checking the strike', followup_id: null,
    area_dates: [expect.objectContaining({ a: expect.objectContaining({ date: '2026-08-01' }), b: expect.objectContaining({ date: '2026-09-06' }) })],
  }));
});

it('pages back through a pass list the catalogue cut short', async () => {
  answer({ '/api/cases/case-a/analysis/zones/aaaaaaaaaaaa': { id: 'aaaaaaaaaaaa', title: 'Port', zones: area } });
  const ago = (days) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  await open({ opening: 'zones-aaaaaaaaaaaa' });
  button('Next: What').click(); await settle(); await pickAnalyzer();
  button('Next: When').click(); await settle();
  button('1 year').click(); await settle();
  post.mockResolvedValueOnce({ dates: [{ date: ago(10), cloud: 2, coverage: 1 }, { date: ago(100), cloud: 5, coverage: 0.4 }],
    truncated: true });
  post.mockResolvedValueOnce({ dates: [{ date: ago(100), cloud: 5, coverage: 1 }, { date: ago(120), cloud: 9, coverage: 1 }],
    truncated: false });
  button('Find passes').click(); await settle();
  expect(target.textContent).toContain('stopped short');
  button('Older passes').click(); await settle();
  expect(post).toHaveBeenLastCalledWith('/api/satellite/sentinel/acquisitions',
    expect.objectContaining({ start: ago(365), end: ago(100) }));
  const listed = [...target.querySelectorAll('.passes li strong')].map((node) => node.textContent);
  expect(listed).toEqual([ago(10), ago(100), ago(120)]);
  expect(target.textContent).not.toContain('stopped short');
  expect(target.textContent).not.toContain('40% of the areas');
});

it('says why a pass did not start, beside the button that started it', async () => {
  answer({ '/api/cases/case-a/analysis/zones/aaaaaaaaaaaa': { id: 'aaaaaaaaaaaa', title: 'Port', zones: area } });
  post.mockRejectedValue(new Error('an area of this detection was deleted; choose its areas again'));
  await open({ opening: 'zones-aaaaaaaaaaaa' });
  button('Next: What').click(); await settle(); await pickAnalyzer();
  button('Next: When').click(); await settle();
  await typeWhenDay('Date A', 'Day of A', '01/08/2026');
  await typeWhenDay('Date B', 'Day of B', '06/09/2026');
  button('Next: Start').click(); await settle();
  button('Run this pass').click(); await settle();
  expect(heading()).toBe('Name and start');
  expect(target.querySelector('.cmp-dock-foot [role="alert"]')?.textContent)
    .toBe('an area of this detection was deleted; choose its areas again');
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
  labelled('Use Port').click(); await settle();
  button('Next: What').click(); await settle(); await pickAnalyzer();
  expect(ceilingSlider().value).toBe('30');
  slide(40);
  button('Next: When').click(); await settle();
  expect(heading()).toBe('Which images, each run');
  expect(target.textContent).toContain('Each run takes the newest pass under 40% cloud as B');
  expect(target.textContent).toContain('The pass before');
  expect(target.textContent).toContain('Only the first run');
  expect(target.textContent).toContain('Choose A, the picture the first run compares with.');
  // a routine names no B: the list offers A alone
  button('Find passes').click(); await settle();
  expect(button('B')).toBeUndefined();
  button('A').click(); await settle();
  button('Next: Start').click(); await settle();
  expect(target.textContent).toContain('Each run: the newest pass under 40% cloud against the one before, first against 2026-08-01');
  button('Save and run the first pass').click(); await settle();
  expect(post).toHaveBeenCalledWith('/api/cases/case-a/analysis/followups', expect.objectContaining({
    date_rule: 'latest_previous', zones: area, area_dates: [expect.objectContaining({
      a: expect.objectContaining({ date: '2026-08-01' }), b: expect.objectContaining({ maxcc: 40 }) })],
  }));
  expect(post).toHaveBeenCalledWith(`/api/cases/case-a/analysis/followups/${WATCH}/run`, {});
  // it lands on the routine's own page, where its runs gather
  expect(heading()).toBe('Harbour weekly');
});

it('says which day the newest pass is and why newer ones were skipped, and reads a cloudier one when asked', async () => {
  // Lyman, 2026-09-26: the map showed that day's pass, while "newest" took the
  // 19th without a word; the three newer passes were over the ceiling
  answer({
    '/api/compare/analyzers': catalogue({ builtins: [structuredClone(vessels), structuredClone(recipe)] }),
    '/api/cases/case-a/analysis/zones/aaaaaaaaaaaa': { id: 'aaaaaaaaaaaa', title: 'Port', zones: area },
  });
  post.mockImplementation(async (path) => (path.endsWith('/acquisitions')
    ? { dates: [
      { date: '2026-09-26', cloud: 51.1, granules: 2, coverage: 1 },
      { date: '2026-09-24', cloud: 82.2, granules: 2, coverage: 1 },
      { date: '2026-09-22', cloud: 89.2, granules: 2, coverage: 1 },
      { date: '2026-09-19', cloud: 0.7, granules: 4, coverage: 1 },
    ], truncated: false }
    : { id: RUN, status: 'queued', input: {}, results: [], total: 1, progress: 0 }));
  const onshow = vi.fn();
  await open({ opening: 'zones-aaaaaaaaaaaa', onshow });
  button('Next: What').click(); await settle(); await pickAnalyzer('Vessels');
  button('Next: When').click(); await settle();
  button('Find passes').click(); await settle();
  expect(target.textContent).toContain(
    'Now 2026-09-19. Newer: 2026-09-26 (51% cloud), 2026-09-24 (82% cloud), 2026-09-22 (89% cloud).');
  // the ceiling sits beside "newest": raised, it takes the 26th and says what that costs
  button('Back').click(); await settle();
  slide(60);
  button('Next: When').click(); await settle();
  expect(button('Newest pass under 60% cloud')).toBeDefined();
  expect(target.textContent).toContain('Now 2026-09-26, looked up again when the run starts.');
  button('Back').click(); await settle();
  slide(30);
  button('Next: When').click(); await settle();
  expect(target.textContent).not.toContain('Above 30%');
  // the analyst has the last word: the cloudier pass is offered, and read
  target.querySelector('[aria-label="Use 2026-09-26"] button').click(); await settle();
  expect(target.textContent).toContain('2026-09-26 is 51% cloud over its tile. It is read anyway');
  // the map is handed its cloud, and a chosen day needs no ceiling
  expect(onshow).toHaveBeenLastCalledWith(expect.objectContaining({ date: '2026-09-26', cloud: 51.1 }));
  expect(ceilingSlider()).toBe(null);
  button('Next: Start').click(); await settle();
  button('Run this pass').click(); await settle();
  expect(post).toHaveBeenCalledWith('/api/cases/case-a/analysis/runs', expect.objectContaining({
    area_dates: [expect.objectContaining({ date_rule: 'manual', b: expect.objectContaining({ date: '2026-09-26' }) })],
  }));
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
  button('Next: What').click(); await settle(); await pickAnalyzer('Vessels');
  button('Next: When').click(); await settle();
  expect(heading()).toBe('Which image');
  // the newest pass is a whole answer, so the step can be passed as it opens
  expect(target.textContent).toContain('The newest pass under 30% cloud, looked up when the run starts.');
  expect(target.querySelector('[aria-label="Day of A"]')).toBe(null);
  expect(button('Next: Start').disabled).toBe(false);
  labelled('Image date').click(); await settle();
  expect(target.querySelector('[aria-label="B pass calendar"]')).not.toBe(null);
  expect(button('Next: Start').disabled).toBe(false);
  button('Find passes').click(); await settle();
  button('Use').click(); await settle();
  button('Next: Start').click(); await settle();
  expect(target.textContent).toContain('2026-09-16');
  button('Run this pass').click(); await settle();
  expect(post).toHaveBeenCalledWith('/api/cases/case-a/analysis/runs', expect.objectContaining({
    area_dates: [expect.objectContaining({ date_rule: 'manual', b: expect.objectContaining({ date: '2026-09-16' }) })],
  }));
});

it('shows each area its own dates and pass lookup in When', async () => {
  const two = [...area, { id: 'far', name: 'Far', kind: 'rect', points: [[9, 40], [9.001, 40.001]] }];
  answer({ '/api/cases/case-a/analysis/zones/aaaaaaaaaaaa': { id: 'aaaaaaaaaaaa', title: 'Port', zones: two } });
  post.mockImplementation(async (path) => (path.endsWith('/acquisitions')
    ? { dates: [{ date: '2026-08-01', cloud: 2, granules: 2, coverage: 1 }], truncated: false }
    : { id: RUN, status: 'queued', input: {}, results: [], total: 1, progress: 0 }));
  await open({ opening: 'zones-aaaaaaaaaaaa' });
  button('Next: What').click(); await settle(); await pickAnalyzer();
  button('Next: When').click(); await settle();
  expect(target.querySelectorAll('[aria-label^="Dates for "]')).toHaveLength(2);
  labelled('Find passes for Area').click(); await settle();
  expect(post).toHaveBeenCalledWith('/api/satellite/sentinel/acquisitions', expect.objectContaining({ zones: [two[0]] }));
  button('A').click(); await settle();
  labelled('Find passes for Far').click(); await settle();
  expect(post).toHaveBeenCalledWith('/api/satellite/sentinel/acquisitions', expect.objectContaining({ zones: [two[1]] }));
  await typeWhenDay('Date A for Far', 'Reference for Far', '20/07/2026');
  expect(target.textContent).toContain('View A');
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
  labelled('Use Port').click(); await settle();
  button('Next: What').click(); await settle(); await pickAnalyzer('Vessels');
  slide(45);
  expect(target.textContent).toContain('Above 30%, the pass taken can be mostly cloud, and ground under cloud is left out.');
  button('Next: When').click(); await settle();
  expect(heading()).toBe('Which image, each run');
  expect(button('Find passes')).toBeUndefined();
  // its one question is the cloud ceiling, right there, with a word above 30%
  expect(target.textContent).not.toContain('Above 30%');
  expect(target.textContent).toContain('Each run reads the newest pass under 45% cloud over the area.');
  expect(button('Next: Start').disabled).toBe(false);
  button('Next: Start').click(); await settle();
  expect(target.textContent).toContain('Each run: the newest pass under 45% cloud');
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
  labelled('Use Port').click(); await settle();
  button('Next: What').click(); await settle(); await pickAnalyzer();
  button('Next: When').click(); await settle();
  [...target.querySelectorAll('[role="radio"]')].find((node) => node.textContent.includes('A fixed picture')).click();
  await settle();
  expect(target.textContent).toContain('Every run compares with');
  expect(target.textContent).toContain('Choose A, the picture every run compares with.');
  await typeWhenDay('Date A', 'Day of A', '01/08/2026');
  button('Next: Start').click(); await settle();
  expect(target.textContent).toContain('Each run: the newest pass under 30% cloud against 2026-08-01');
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
  button('Next: What').click(); await settle(); await pickAnalyzer();
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

it('picks no analyzer for you, keeps its categories folded, and holds a pressed size for the next one', async () => {
  answer({ '/api/cases/case-a/analysis/zones/aaaaaaaaaaaa': { id: 'aaaaaaaaaaaa', title: 'Port', zones: area } });
  await open({ opening: 'zones-aaaaaaaaaaaa' });
  button('Next: What').click(); await settle();
  const step = target.querySelector('section[aria-label="What to look for"]');
  const list = step.querySelector('[aria-label="Analyzer"]');
  expect([...list.querySelectorAll('.fold')].map((fold) => fold.getAttribute('aria-expanded'))).toEqual(['false']);
  expect(list.querySelectorAll('[role="radio"]')).toHaveLength(0);
  expect(step.querySelector('[aria-label="Target size"]')).toBe(null);
  expect(button('Next: When').disabled).toBe(true);
  expect(target.textContent).toContain('Pick what to look for.');
  await pickAnalyzer();
  expect(button('Next: When').disabled).toBe(false);
  // the size is asked once something is picked, under the list
  const sizes = step.querySelectorAll('[aria-label="Target size"]');
  expect(sizes.length).toBe(1);
  expect(list.compareDocumentPosition(sizes[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const pressed = () => [...step.querySelectorAll('[aria-label="Target size"] button')]
    .filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent.trim());
  button('Large').click(); await settle();
  [...list.querySelectorAll('[role="radio"]')].find((b) => b.textContent.includes('Vessels')).click(); await settle();
  expect(pressed()).toEqual(['Large']);
  // folded, a category still names what was picked in it
  list.querySelector('.fold').click(); await settle();
  expect(list.querySelector('.fold').textContent).toContain('Vessels');
});

it('offers the cloud switch on by default, and none for a method that rejects cloud itself', async () => {
  answer({ '/api/cases/case-a/analysis/zones/aaaaaaaaaaaa': { id: 'aaaaaaaaaaaa', title: 'Port', zones: area } });
  await open({ opening: 'zones-aaaaaaaaaaaa' });
  button('Next: What').click(); await settle(); await pickAnalyzer();
  const chip = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Clouds & shadows'));
  expect(chip.getAttribute('aria-pressed')).toBe('true');
  expect(target.textContent).toContain('traced from the sun');
  unmount(live); target.innerHTML = '';
  answer({
    '/api/compare/analyzers': catalogue({ builtins: [{ ...structuredClone(recipe), id: 'anomaly', method: 'hotspots' }] }),
    '/api/cases/case-a/analysis/zones/aaaaaaaaaaaa': { id: 'aaaaaaaaaaaa', title: 'Port', zones: area },
  });
  await open({ opening: 'zones-aaaaaaaaaaaa' });
  button('Next: What').click(); await settle(); await pickAnalyzer();
  expect(target.textContent).not.toContain('Clouds & shadows');
});

it('says what a partial pass will leave unswept before the run, not after', async () => {
  answer({ '/api/cases/case-a/analysis/zones/aaaaaaaaaaaa': { id: 'aaaaaaaaaaaa', title: 'Port', zones: area } });
  post.mockResolvedValue({ dates: [{ date: '2026-05-04', cloud: 12, granules: 1, coverage: 0.62 }], truncated: false });
  await open({ opening: 'zones-aaaaaaaaaaaa' });
  button('Next: What').click(); await settle(); await pickAnalyzer();
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
  expect(target.textContent).toContain('build your own from rules you prove on the map, or copy a calibrated built-in');
  await unfold();
  starts('Vessels').click(); await settle();
  expect(target.textContent).toContain('Measures Vessels: infrared contrast over water');
  expect(button('Save changes')).toBeUndefined();
  expect(button('Copy to tune')).toBeDefined();
  button('Back').click(); await settle();

  await unfold();
  labelled(`Copy ${recipe.name}`).click(); await settle();
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
  // gone for every case, with no Trash to come back from: it asks first
  expect(del).not.toHaveBeenCalled();
  [...document.querySelectorAll('[role="alertdialog"] button')].find((b) => b.textContent.trim() === 'Delete').click();
  await settle();
  expect(del).toHaveBeenCalledWith('/api/compare/analyzers/custom-1');
});

// -- analyzers of your own rules ------------------------------------------------------

const rulesMethods = [...methods, { id: 'rules', label: 'Your own rules', single: false, clouds: true,
  sensor: 'sentinel2', frames: 4, sizes, measure: '', rules: true },
{ id: 'sar-change', label: 'Radar change', single: false, clouds: false, sensor: 'sentinel1', frames: 4,
  sizes, measure: '', smoothing_m: 45 }];
const rulesCatalogue = (extra = {}) => catalogue({ methods: rulesMethods, rules: {
  bands: ['B02', 'B03', 'B04', 'B08', 'B11', 'B12'], classes: ['vegetation', 'bare', 'water'],
  max_rules: 6, max_bands: 6, max_around: 300, max_checks: 12, max_marks: 60, max_check_tiles: 20 }, ...extra });
const VIEW = { west: 2, south: 48, east: 2.05, north: 48.03 };
const debounce = (ms = 320) => new Promise((resolve) => setTimeout(resolve, ms));
const phrase = () => [...target.querySelectorAll('.phrase')].map((p) => p.textContent.trim())[0];
const tab = (name) => [...target.querySelectorAll('[role="tab"]')].find((b) => b.textContent.trim().startsWith(name));
const rule = (extra = {}) => ({ measure: 'index', index: 'nbr', bands: ['B08', 'B04'], band: 'B08', polarisation: 'vv',
  classes: [], on: 'change', op: 'le', value: -0.2, upper: 0, around: 0, ...extra });
const group = (name) => target.querySelector(`[role="group"][aria-label="${name}"]`);
const inGroup = (name, text) => [...group(name).querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(text));
const type = (input, value, event = 'input') => { input.value = value; input.dispatchEvent(new Event(event, { bubbles: true })); };

/** What a test of a check sends back: every pin found or left empty as it should, unless told otherwise. */
const tested = (body, covered = body.check.marks.map((mark) => mark.expect === 'found'), without) => ({
  ready: true, missing: 0, count: covered.filter(Boolean).length, covered, size: 512, tiles: [], measured: 0.9, without,
  rules: body.recipe.rules.map(() => ({ share: 0.012, kept: 0.012 })), kept: 0.01,
  candidates: [{ id: '0-1', coordinates: [2.01, 48.01], bbox: [2.01, 48.01, 2.011, 48.011], area: 900,
    margin: 4, strength: 'strong', measure: {}, geometry: null }],
  readings: body.check.marks.map(() => ({ imaged: true, measured: true, kept: true,
    rules: body.recipe.rules.map(() => ({ passes: true, value: -0.6, before: 0.8, after: 0.2 })) })) });

function copernicus({ test = (body) => tested(body), plan = () => ({ tiles: 1, missing: 2 }) } = {}) {
  post.mockImplementation(async (path, body) => {
    if (path === '/api/satellite/sentinel/acquisitions') {
      return { dates: [{ date: '2026-05-11', cloud: 5, coverage: 1 }, { date: '2026-05-04', cloud: 3, coverage: 1 }], truncated: false };
    }
    if (path === '/api/compare/analyzers/check/plan') return plan(body);
    if (path === '/api/compare/analyzers/check') return body.read ? test(body) : { ready: false, missing: 2 };
    if (path === '/api/compare/analyzers/probe') {
      return { ready: true, imaged: true, measured: true, kept: true, rules: [{ passes: true, value: -0.6, before: 0.8, after: 0.2 }] };
    }
    return { ...body, id: 'custom-aaaaaaaaaaaa' };
  });
}

/** The panel with the bench the map would read, open on a new analyzer of Sentinel-2 and two dates. */
async function openBuilder(props = {}) {
  const { default: Fixture } = await import('./BenchPanel.fixture.svelte');
  live = mount(Fixture, { target, props: { caseId: 'case-a', viewBounds: () => VIEW, ...props } });
  await settle();
  labelled('Analyzers').click(); await settle();
  button('New analyzer').click(); await settle();
  starts('Blank').click(); await settle();
  return benchOf();
}
const benchOf = async () => (await import('./benchHolder.fixture.svelte.js')).holder.bench;

/** What the console over the map does to make a check: its passes, then its pins. */
async function makeCheck(bench, points = [{ lon: 2.01, lat: 48.01 }]) {
  bench.startDraft(); await settle();
  await bench.lookUpPasses(); await settle();
  bench.setPass('a', { date: '2026-05-04' });
  bench.setPass('b', { date: '2026-05-11' });
  bench.continueDraft();
  for (const point of points) bench.dropPin(point);
  bench.finishDraft(); await settle();
  await debounce(); await settle();
}

const SHIP = { id: 'ships', place: 'Fujairah', when: 'one pass, January 2024', recipe: {
  id: 'custom', name: 'Ships at anchor', description: '', phenomenon: 'Vessel candidate', method: 'rules', sensor: 'sentinel2',
  dates: 'one', colour: '#38bdf8', style: 'both', match: 'all', parameters: recipe.parameters,
  rules: [rule({ measure: 'band', band: 'B08', on: 'b', op: 'ge', value: 0.04 })], checks: [] } };

it('asks what a new analyzer reads before anything else, and offers the examples that fit it', async () => {
  answer({ '/api/compare/analyzers': rulesCatalogue({ examples: [EXAMPLE, SHIP], radar_layer: '' }) });
  post.mockImplementation(async (_, body) => ({ ...body, id: 'custom-aaaaaaaaaaaa' }));
  await open({ viewBounds: () => VIEW });
  labelled('Analyzers').click(); await settle();
  button('New analyzer').click(); await settle();
  expect(heading()).toBe('New analyzer');
  expect(target.textContent).toContain('What it reads is fixed from here on');
  // Sentinel-2 and two dates to begin with: the burn fits, the ships do not
  expect(inGroup('Satellite', 'Sentinel-2').getAttribute('aria-pressed')).toBe('true');
  expect(inGroup('Dates', 'Two dates').getAttribute('aria-pressed')).toBe('true');
  expect(labelled('Start from the example Fresh burn')).not.toBe(null);
  expect(labelled('Start from the example Ships at anchor')).toBe(null);
  inGroup('Dates', 'One date').click(); await settle();
  expect(labelled('Start from the example Ships at anchor')).not.toBe(null);
  expect(labelled('Start from the example Fresh burn')).toBe(null);
  // radar has no example yet, and says what it needs
  inGroup('Satellite', 'Sentinel-1').click(); await settle();
  expect(target.textContent).toContain('No ready example for Sentinel-1 radar · one date yet.');
  expect(target.textContent).toContain('Needs the Sentinel-1 layer');

  starts('Blank').click(); await settle();
  expect(heading()).toBe('Build an analyzer');
  expect(target.querySelector('.reads').textContent.trim()).toBe('Sentinel-1 radar · one date');
  expect(target.querySelector('[aria-label="Rule 1 polarisation"]')).not.toBe(null);
  // one date has no before or after to choose, and radar has one thing to measure
  expect(target.querySelector('[aria-label="Rule 1 reads"]')).toBe(null);
  expect(target.querySelector('[aria-label="Rule 1 measures"]')).toBe(null);
  expect(phrase()).toBe('Keeps ground where VV is at least −4.0 dB.');
});

it('builds an analyzer from rules, proves it on a check made on the map, and keeps it for every case', async () => {
  answer({ '/api/compare/analyzers': rulesCatalogue() });
  copernicus();
  const bench = await openBuilder();
  expect(heading()).toBe('Build an analyzer');
  expect(target.querySelector('.reads').textContent.trim()).toBe('Sentinel-2 · two dates');
  expect(phrase()).toBe('Keeps ground where brightness moved by 5.0% or more either way, outside cloud.');
  expect(tab('Rules').getAttribute('aria-selected')).toBe('true');
  // building reads nothing, and with no check on the map there is nothing to test
  await debounce(); await settle();
  expect(post).not.toHaveBeenCalled();
  expect(target.querySelector('.strip').textContent).toContain('No check on the map');
  expect(button('Test').disabled).toBe(true);
  expect(button('Add to my analyzers').disabled).toBe(true);
  expect(target.querySelector('.reason').textContent).toBe('Name it to save it.');
  type(target.querySelector('[aria-label="Analyzer name"]'), 'Cleared ground'); await settle();
  expect(target.querySelector('.reason').textContent).toBe('Add a check: a place where this analyzer should find something.');

  // the map makes the check: the column waits while it does
  bench.startDraft(); await settle();
  expect(target.querySelector('.panel').classList.contains('locked')).toBe(true);
  expect(target.textContent).toContain('Making a check on the map');
  await bench.lookUpPasses(); await settle();
  expect(post).toHaveBeenCalledWith('/api/satellite/sentinel/acquisitions', expect.objectContaining({ collection: 'sentinel2' }));
  bench.setPass('a', { date: '2026-05-04' });
  bench.setPass('b', { date: '2026-05-11' });
  bench.continueDraft();
  bench.dropPin({ lon: 2.01, lat: 48.01 });
  bench.finishDraft(); await settle();
  expect(target.querySelector('.panel').classList.contains('locked')).toBe(false);
  expect(tab('Checks').textContent.replace(/\s+/g, '')).toBe('Checks1');

  // what testing it costs is asked once, and said on the button
  await debounce(); await settle();
  const planned = post.mock.calls.filter(([path]) => path === '/api/compare/analyzers/check/plan');
  expect(planned).toHaveLength(1);
  expect(planned[0][1]).toMatchObject({ recipe: { method: 'rules', sensor: 'sentinel2', dates: 'two' },
    check: { name: 'Check 1', a: { date: '2026-05-04' }, b: { date: '2026-05-11' } } });
  expect(target.querySelector('.strip').textContent).toContain('Check 1');
  expect(button('Test · 2 requests')).toBeDefined();
  button('Test · 2 requests').click(); await settle();
  expect(post).toHaveBeenLastCalledWith('/api/compare/analyzers/check', expect.objectContaining({ read: true, detail: true }));
  expect(target.querySelector('.strip').textContent).toContain('1 of 1 found');
  expect(button('Tested').disabled).toBe(true);
  expect(target.textContent).toContain('1.2 % of the ground');

  expect(button('Add to my analyzers').disabled).toBe(false);
  button('Add to my analyzers').click(); await settle();
  expect(post).toHaveBeenCalledWith('/api/compare/analyzers', expect.objectContaining({
    id: 'custom', method: 'rules', name: 'Cleared ground', match: 'all', sensor: 'sentinel2', dates: 'two',
    description: 'Keeps ground where brightness moved by 5.0% or more either way, outside cloud.',
    rules: [expect.objectContaining({ measure: 'brightness', on: 'change', op: 'moved', value: 0.05 })],
    checks: [expect.objectContaining({ name: 'Check 1', marks: [{ point: [2.01, 48.01], expect: 'found' }],
      result: expect.objectContaining({ count: 1, covered: [true] }) })] }));
});

it('needs a pin where something should be found before it is saved, and a trap alone does not do', async () => {
  answer({ '/api/compare/analyzers': rulesCatalogue() });
  copernicus();
  const bench = await openBuilder();
  type(target.querySelector('[aria-label="Analyzer name"]'), 'Cleared ground'); await settle();
  bench.startDraft();
  await bench.lookUpPasses();
  bench.setPass('a', { date: '2026-05-04' });
  bench.setPass('b', { date: '2026-05-11' });
  bench.continueDraft();
  bench.arm('empty');
  bench.dropPin({ lon: 2.02, lat: 48.02 });
  bench.finishDraft(); await settle();
  expect(button('Add to my analyzers').disabled).toBe(true);
  expect(target.querySelector('.reason').textContent).toBe('A check needs a pin where something should be found.');
  bench.select(bench.checks[0].id);
  bench.arm('found');
  bench.dropPin({ lon: 2.03, lat: 48.02 }); await settle();
  expect(button('Add to my analyzers').disabled).toBe(false);
});

it('waits for a check being made on the map, and lets it go', async () => {
  answer({ '/api/compare/analyzers': rulesCatalogue() });
  copernicus();
  const bench = await openBuilder();
  bench.startDraft(); await settle();
  expect(target.querySelector('.panel').hasAttribute('inert')).toBe(true);
  expect(target.querySelector('.cmp-dock-foot').hasAttribute('inert')).toBe(true);
  button('Cancel the check').click(); await settle();
  expect(bench.draft).toBe(null);
  expect(target.querySelector('.panel').hasAttribute('inert')).toBe(false);
  expect(target.textContent).not.toContain('Making a check on the map');
});

const EXAMPLE = { id: 'burn', place: 'Lahaina, Maui', when: 'August 2023', recipe: {
  id: 'custom', name: 'Fresh burn', description: 'The burn ratio dropped.', phenomenon: 'Fresh burn', method: 'rules',
  sensor: 'sentinel2', dates: 'two', colour: '#ef4444', style: 'both', match: 'all',
  parameters: { ...recipe.parameters, shape: 'any', merge_metres: 30 },
  rules: [rule(), rule({ on: 'b', value: 0.1 })],
  checks: [
    { id: 'town', name: 'The town that burned', a: { provider: 'sentinel2', date: '2023-08-08', layer: 'SWIR', maxcc: 100 },
      b: { provider: 'sentinel2', date: '2023-08-13', layer: 'SWIR', maxcc: 100 },
      marks: [{ point: [-156.675, 20.872], expect: 'found' }, { point: [-156.675, 20.894], expect: 'found' }], result: null },
    { id: 'reef', name: 'The reef off the town', a: { provider: 'sentinel2', date: '2023-08-08', layer: 'SWIR', maxcc: 100 },
      b: { provider: 'sentinel2', date: '2023-08-13', layer: 'SWIR', maxcc: 100 },
      marks: [{ point: [-156.6753, 20.865], expect: 'empty' }], result: null },
  ] } };

it('starts from an example: copies it with its checks, opens on the first and tests them all when asked', async () => {
  answer({ '/api/compare/analyzers': rulesCatalogue({ examples: [EXAMPLE] }) });
  const tests = [];
  copernicus({ test: (body) => {
    tests.push(body);
    // the reef gets a candidate on it: the check that should stay empty does not
    // and without the second rule the town would lose a pin
    return tested(body, body.check.id === 'town' ? [true, true] : [true],
      body.check.id === 'town' ? [{ covered: [true, true] }, { covered: [false, true] }] : undefined);
  }, plan: () => ({ tiles: 1, missing: 2 }) });
  const onfly = vi.fn();
  const { default: Fixture } = await import('./BenchPanel.fixture.svelte');
  live = mount(Fixture, { target, props: { caseId: 'case-a', viewBounds: () => VIEW, onfly } });
  await settle();
  labelled('Analyzers').click(); await settle();
  button('New analyzer').click(); await settle();
  expect(target.textContent).toContain('Lahaina, Maui · August 2023 · 2 checks');
  labelled('Start from the example Fresh burn').click(); await settle();

  // it is in the library at once, under a name of its own, checks and all
  expect(post).toHaveBeenCalledWith('/api/compare/analyzers', expect.objectContaining({
    id: 'custom', name: 'Fresh burn', checks: EXAMPLE.recipe.checks }));
  expect(toast).toHaveBeenCalledWith('Fresh burn is in your analyzers, with its checks', 'ok');
  expect(heading()).toBe('Edit Fresh burn');
  expect(tab('Checks').getAttribute('aria-selected')).toBe('true');
  // the first check is on the map: its pins are framed, its passes are the imagery
  const bench = await benchOf();
  expect(bench.check.name).toBe('The town that burned');
  expect(onfly).toHaveBeenCalledWith({ bounds: expect.objectContaining({ west: expect.any(Number) }) });
  expect(bench.imagery).toMatchObject({ mode: 'swipe', a: { date: '2023-08-08' }, b: { date: '2023-08-13', layer: 'SWIR' } });
  expect(target.textContent).toContain('Before 2023-08-08 → After 2023-08-13');

  // what testing costs is asked for each check, and Test all says the total before it reads anything
  await debounce(); await settle();
  expect(tests).toHaveLength(0);
  expect(button('Test all · up to 4 requests')).toBeDefined();
  expect(target.textContent).toContain('2 requests to read');
  button('Test all · up to 4 requests').click(); await settle();
  expect(tests.map((body) => [body.check.id, body.detail])).toEqual([['town', true], ['reef', false]]);
  expect(target.textContent).toContain('2 of 2 found');
  expect(target.textContent).toContain('1 of 1 flagged');
  expect(tab('Checks').textContent.replace(/\s+/g, '')).toBe('Checks1/2');

  // the rules say what the pins would come to without each of them
  tab('Rules').click(); await settle();
  expect(target.querySelector('[aria-label="Rule 1 effect"]').textContent).toBe('Without it, no pin changes.');
  expect(target.querySelector('[aria-label="Rule 2 effect"]').textContent).toBe('Without it, 1 pin would come out wrong.');
  // and stop saying it once a line has moved, since it was said for the old one
  type(target.querySelector('[aria-label="Rule 1 value"]'), '0.5', 'change'); await settle();
  expect(target.querySelector('[aria-label="Rule 1 effect"]')).toBe(null);
});

it('gives each analyzer opened in the builder a bench of its own, even when another is already open', async () => {
  const one = { ...structuredClone(recipe), id: 'custom-aaaaaaaaaaaa', name: 'First', method: 'rules', match: 'all', sensor: 'sentinel2',
    dates: 'two', rules: [rule({ value: -0.3 })], checks: [] };
  const two = { ...one, id: 'custom-bbbbbbbbbbbb', name: 'Second', rules: [rule({ value: -0.5 })] };
  answer({ '/api/compare/analyzers': rulesCatalogue({ custom: [one, two] }) });
  const props = liveProps({ caseId: null, opening: 'analyzer:custom-aaaaaaaaaaaa', viewBounds: () => VIEW });
  const { default: Fixture } = await import('./BenchPanel.fixture.svelte');
  live = mount(Fixture, { target, props });
  await settle();
  await settle();
  const first = await benchOf();
  expect(first.recipe.name).toBe('First');
  expect(heading()).toBe('Edit First');

  // asked for from elsewhere while the first is open: the second takes the map, and the first lets go of it
  props.opening = 'analyzer:custom-bbbbbbbbbbbb'; await settle();
  const second = await benchOf();
  expect(second).not.toBe(first);
  expect(second.recipe.name).toBe('Second');
  expect(heading()).toBe('Edit Second');
  expect(target.querySelector('[aria-label="Rule 1 value"]').value).toBe('0.5');
  // what is made now is kept on the second, not on a bench left over from the first
  second.startDraft(); await settle();
  expect(target.querySelector('.panel').classList.contains('locked')).toBe(true);
  second.cancelDraft(); await settle();
  expect(first.recipe.checks).toEqual([]);
  // leaving the builder puts the map back
  button('Cancel').click(); await settle();
  expect((await benchOf())).toBe(null);
});

it('reads a point on the map and drops a pin from it, and a stricter line turns the check red', async () => {
  answer({ '/api/compare/analyzers': rulesCatalogue() });
  let covered = true;
  copernicus({ test: (body) => tested(body, [covered]) });
  const bench = await openBuilder();
  type(target.querySelector('[aria-label="Analyzer name"]'), 'Cleared ground'); await settle();
  await makeCheck(bench);
  bench.select(bench.checks[0].id);
  await debounce(); await settle();
  button('Test · 2 requests').click(); await settle();
  expect(target.querySelector('.strip').textContent).toContain('1 of 1 found');

  // a click on the ground reads every rule there, and can leave a pin
  await bench.probeAt({ lon: 2.02, lat: 48.02 }); await settle();
  expect(post).toHaveBeenLastCalledWith('/api/compare/analyzers/probe', expect.objectContaining({ point: [2.02, 48.02] }));
  bench.markProbe('empty'); await settle();
  expect(bench.marks.map((mark) => mark.expect)).toEqual(['found', 'empty']);
  expect(target.querySelector('.strip').textContent).toContain('The rules changed since the last test.');

  // a stricter line loses the plot: nothing is reread until the button is pressed
  covered = false;
  const tests = () => post.mock.calls.filter(([path, body]) => path === '/api/compare/analyzers/check' && body.read).length;
  const before = tests();
  type(target.querySelector('[aria-label="Rule 1 value"]'), '60', 'change'); await settle();
  await debounce(); await settle();
  expect(tests()).toBe(before);
  expect(post.mock.calls.filter(([path]) => path === '/api/compare/analyzers/check/plan')).toHaveLength(2);
  starts('Test again').click(); await settle();
  expect(tests()).toBe(before + 1);
  expect(target.querySelector('.strip').textContent).toContain('0 of 1 found');
  expect(tab('Checks').textContent.replace(/\s+/g, '')).toBe('Checks0/1');
  expect(post.mock.calls.findLast(([path]) => path === '/api/compare/analyzers/check')[1].recipe.rules[0].value).toBe(0.6);
});

it('shows the detections alone on the map, and keeps each eye for the way back', async () => {
  answer({ '/api/compare/analyzers': rulesCatalogue() });
  copernicus();
  const bench = await openBuilder();
  button('Add a rule').click(); await settle();
  const eye = (n) => target.querySelector(`button.dot[aria-label$="rule ${n} on the map"]`).getAttribute('aria-pressed');
  labelled('Hide rule 2 on the map').click(); await settle();
  expect([eye(1), eye(2)]).toEqual(['true', 'false']);
  // the detections alone: nothing of the rules is painted, so every eye reads closed
  bench.view = 'detections'; await settle();
  expect([eye(1), eye(2)]).toEqual(['false', 'false']);
  // back to the rules, each eye as it was left
  bench.view = 'rules'; await settle();
  expect([eye(1), eye(2)]).toEqual(['true', 'false']);
  // an eye pressed from the detections opens its rule and brings the rules back
  bench.view = 'detections'; await settle();
  labelled('Show rule 2 on the map').click(); await settle();
  expect(bench.view).toBe('rules');
  expect([eye(1), eye(2)]).toEqual(['true', 'true']);
});

it('adds, ranks, rewrites and removes rules, and the sentence follows', async () => {
  answer({ '/api/compare/analyzers': rulesCatalogue() });
  await openBuilder();
  button('Add a rule').click(); await settle();
  expect(phrase()).toBe('Keeps ground where brightness moved by 5.0% or more either way and NDVI before is at least 0.40, outside cloud.');
  button('any rule').click(); await settle();
  expect(phrase()).toContain('or NDVI before is at least 0.40');
  labelled('Rank candidates by rule 2').click(); await settle();
  expect(phrase()).toMatch(/^Keeps ground where NDVI before is at least 0.40 or brightness moved/);
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
    method: 'rules', sensor: 'sentinel2', dates: 'two', colour: '#f6a81a', style: 'both',
    parameters: { ...recipe.parameters, shape: 'any' }, match: 'all', rules: [rule({ value: -0.27 })], checks: [] };
  answer({ '/api/compare/analyzers': rulesCatalogue({ as_rules: { 'large-change': asRules } }) });
  await open({ viewBounds: () => VIEW });
  labelled('Analyzers').click(); await settle();
  await unfold();
  starts('Any surface change').click(); await settle();
  button('Open as rules').click(); await settle();
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
  expect(target.textContent).toContain('2 checks · not tested');
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
  expect(target.textContent).toContain('Keep in this run, or pin the place and evidence to Files.');

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
  button('Next: What').click(); await settle(); await pickAnalyzer();
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
  button('Next: What').click(); await settle(); await pickAnalyzer('Vessels by radar');
  expect(target.textContent).toContain('not set up yet');
  expect(button('How to add it, in Settings → Imagery')).toBeDefined();
  expect(button('Next: When').disabled).toBe(true);
  // the water it is judged against is one more request a tile, said back in Where
  button('Back').click(); await settle();
  expect(target.textContent).toContain('1 tile · 3 requests a run');
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
  button('Next: What').click(); await settle(); await pickAnalyzer();
  const groups = [...target.querySelectorAll('.choices .fold .label')].map((node) => node.textContent);
  expect(groups).toEqual(['Vessels', 'Any change']);
  const radarRow = [...target.querySelectorAll('.choice')].find((node) => node.textContent.includes('Vessels by radar'));
  expect(radarRow.textContent).toContain('(reliable)');
  expect(radarRow.textContent).toContain('set up');
  expect(radarRow.getAttribute('title')).toBe('Needs the Sentinel-1 layer');
  expect(target.textContent).toContain('(rough)');
});
