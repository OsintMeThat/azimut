// @vitest-environment happy-dom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const sizes = {
  small: { min_area: 300, max_area: 0, cleanup: 0, smoothing: 0, merge_metres: 0 },
  medium: { min_area: 2000, max_area: 0, cleanup: 1, smoothing: 0, merge_metres: 30 },
  large: { min_area: 20000, max_area: 0, cleanup: 1, smoothing: 1, merge_metres: 100 },
};
const recipe = { id: 'large-change', name: 'Any surface change', description: 'Reflectance that moved',
  phenomenon: 'Surface change', method: 'surface', zones: [], colour: '#f6a81a', style: 'both',
  parameters: { sensitivity: 67, ...sizes.medium, index: 'ndvi', direction: 'both',
    ignore_clouds: true, ignore_shadows: true, cloud_margin: 5 } };
const vessels = { ...recipe, id: 'boats', name: 'Vessels', method: 'vessels', phenomenon: 'Vessel candidate' };
const methods = [
  { id: 'surface', label: 'Any reflectance change', single: false, clouds: true, sizes,
    measure: 'Reflectance moved by {value}%' },
  { id: 'vessels', label: 'Vessels', single: true, clouds: true, sizes,
    measure: '{value}× brighter than the water around it' },
  { id: 'hotspots', label: 'Hotspots', single: true, clouds: false, sizes,
    measure: 'Short-wave infrared {value}× the bands beside it' },
];
const catalogue = (extra = {}) => ({ builtins: [structuredClone(recipe), structuredClone(vessels)],
  custom: [], methods, max_tiles: 4096, max_results: 2000, grid: [13, 512], ...extra });
const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();
const del = vi.fn();
vi.mock('../../lib/api.js', () => ({ api: { get, post, patch, put: vi.fn(), del } }));
vi.mock('../../lib/state.svelte.js', () => ({ ensureCase: async () => ({ id: 'case-a' }),
  reloadCase: async () => {}, toast: vi.fn() }));
const { default: Panel } = await import('./AnalyzerPanel.svelte');
let live, target;
const settle = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); flushSync(); };
const button = (text) => [...target.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
const maps = {
  a: { provider: 'sentinel2', sentinel: { date: '2026-05-04', layer: 'TRUE_COLOR', maxcc: 30 } },
  b: { provider: 'sentinel2', sentinel: { date: '2026-05-11', layer: 'TRUE_COLOR', maxcc: 30 } },
};
const area = [{ id: 'area', name: 'Area', kind: 'rect', points: [[2, 48], [2.001, 48.001]] }];

beforeEach(() => {
  vi.clearAllMocks();
  get.mockImplementation(async (path) => path === '/api/compare/analyzers' ? catalogue() : []);
  target = document.createElement('div'); document.body.append(target);
});
afterEach(() => { if (live) unmount(live); target.remove(); });

it('opening reads local libraries without downloading imagery or starting a calculation', async () => {
  live = mount(Panel, { target, props: { caseId: 'case-a' } });
  await settle();
  expect(get.mock.calls.map(([path]) => path).sort()).toEqual([
    '/api/cases/case-a/analysis/followups', '/api/cases/case-a/analysis/runs',
    '/api/cases/case-a/analysis/zones', '/api/compare/analyzers',
  ]);
  expect(post).not.toHaveBeenCalled();
  expect(button('Run on no areas').disabled).toBe(true);
  expect(target.textContent).toContain('Draw an area to analyze');
});

it('takes its imagery from the two maps, and only Run sends anything', async () => {
  post.mockImplementation(async (_, body) => ({ id: '123456789abc', title: body.title,
    status: 'failed', message: 'Offline fixture', progress: 0, total: 1, input: body, results: [] }));
  live = mount(Panel, { target, props: { caseId: 'case-a', zones: area, sources: maps } });
  await settle();
  // No click on an imagery control: the maps above the stage already said it.
  expect(target.textContent).toContain('From the maps');
  expect(target.textContent).toContain('2026-05-04');
  expect(post).not.toHaveBeenCalled();
  button('Run on 1 area').click(); await settle();
  expect(post).toHaveBeenCalledWith('/api/cases/case-a/analysis/runs', expect.objectContaining({
    zones: area,
    a: { provider: 'sentinel2', date: '2026-05-04', layer: 'TRUE_COLOR', maxcc: 30 },
    b: { provider: 'sentinel2', date: '2026-05-11', layer: 'TRUE_COLOR', maxcc: 30 },
  }));
  expect(target.textContent).toContain('Offline fixture');
});

it('takes the wheel when the maps show imagery Detect cannot read', async () => {
  const onsources = vi.fn();
  const wayback = { a: { provider: 'esri-wayback', wayback_release: 1 }, b: { provider: 'esri-wayback', wayback_release: 2 } };
  live = mount(Panel, { target, props: { caseId: 'case-a', zones: area, sources: wayback, onsources } });
  await settle();
  expect(target.textContent).toContain('Detect reads Sentinel-2, so the maps now show it.');
  expect(onsources).toHaveBeenCalledWith(expect.objectContaining({
    a: expect.objectContaining({ provider: 'sentinel2' }), b: expect.objectContaining({ provider: 'sentinel2' }),
  }));
  expect(target.querySelector('select[aria-label="Analyzer source"]')).toBe(null);
  expect(button('Run on 1 area').disabled).toBe(true);
  expect(target.textContent).toContain('Choose the image to compare');
});

it('prices an area in tiles and requests, and refuses one the engine would reject', async () => {
  const zones = [{ id: 'big', name: 'Whole region', kind: 'rect', points: [[2, 48], [8, 54]] }];
  get.mockImplementation(async (path) => path === '/api/compare/analyzers' ? catalogue({ max_tiles: 256 }) : []);
  live = mount(Panel, { target, props: { caseId: 'case-a', zones, sources: maps } });
  await settle();
  expect(button('Run on 1 area').disabled).toBe(true);
  expect(target.textContent).toContain('the limit is 256');
  unmount(live); target.remove();
  target = document.createElement('div'); document.body.append(target);
  live = mount(Panel, { target, props: { caseId: 'case-a', zones: area, sources: maps } });
  await settle();
  // one tile, a picture and a band product for each of two dates
  expect(target.textContent).toContain('1 tile · 4 requests');
  expect(post).not.toHaveBeenCalled();
});

it('sets a size as a whole set of numbers, and shows when it was tuned by hand', async () => {
  live = mount(Panel, { target, props: { caseId: 'case-a' } });
  await settle();
  const pressed = () => [...target.querySelectorAll('[aria-label="Target size"] button')]
    .filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent.trim());
  expect(pressed()).toEqual(['Medium']);
  button('Small').click(); await settle();
  expect(pressed()).toEqual(['Small']);
  button('Adjust thresholds…').click(); await settle();
  expect(target.querySelector('[aria-label="Minimum area"]').value).toBe('300');
  const minimum = target.querySelector('[aria-label="Minimum area"]');
  minimum.value = '120'; minimum.dispatchEvent(new Event('input', { bubbles: true })); await settle();
  expect(pressed()).toEqual([]);
});

it('offers the cloud switch on by default, and none for a method that rejects cloud itself', async () => {
  live = mount(Panel, { target, props: { caseId: 'case-a' } });
  await settle();
  const chip = [...target.querySelectorAll('button')].find((b) => b.textContent.includes('Clouds & shadows'));
  expect(chip.getAttribute('aria-pressed')).toBe('true');
  expect(target.textContent).toContain('traced from the sun');
  unmount(live); target.remove();
  target = document.createElement('div'); document.body.append(target);
  get.mockImplementation(async (path) => path === '/api/compare/analyzers'
    ? catalogue({ builtins: [{ ...structuredClone(recipe), id: 'anomaly', method: 'hotspots' }] }) : []);
  live = mount(Panel, { target, props: { caseId: 'case-a' } });
  await settle();
  expect(target.textContent).not.toContain('Clouds & shadows');
});

it('starts an analyzer of your own from the plus, and cannot write over a built-in', async () => {
  post.mockImplementation(async (_, body) => ({ ...body, id: 'custom-copy' }));
  live = mount(Panel, { target, props: { caseId: 'case-a' } }); await settle();
  // A built-in offers to be read and copied, never saved over.
  button('See how it is built…').click(); await settle();
  expect(target.textContent).not.toContain('Works on Wayback');
  expect(button('Save changes')).toBeUndefined();
  expect(button('Delete')).toBeUndefined();
  button('Hide this analyzer').click(); await settle();

  target.querySelector('button[aria-label="New analyzer"]').click(); await settle();
  const copy = [...target.querySelectorAll('.new-menu button')]
    .find((entry) => entry.textContent.includes(`Copy “${recipe.name}”`));
  copy.click(); await settle();
  expect(target.querySelector('[aria-label="Analyzer"]').value).toBe('custom');
  expect(target.textContent).toContain('not saved yet');
  const name = target.querySelector('[aria-label="Analyzer name"]');
  expect(name.value).toBe(`${recipe.name} copy`);
  name.value = 'Weekly harbour'; name.dispatchEvent(new Event('input', { bubbles: true }));
  button('Add to my analyzers').click(); await settle();
  expect(post).toHaveBeenCalledWith('/api/compare/analyzers', expect.objectContaining({ id: 'custom', name: 'Weekly harbour' }));
});

it('edits and removes an analyzer of its own, which the library never did offer', async () => {
  const own = { ...structuredClone(recipe), id: 'custom-1', name: 'Weekly harbour' };
  get.mockImplementation(async (path) => path === '/api/compare/analyzers' ? catalogue({ custom: [own] }) : []);
  live = mount(Panel, { target, props: { caseId: 'case-a' } }); await settle();
  const select = target.querySelector('[aria-label="Analyzer"]');
  select.value = 'custom-1'; select.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  button('Edit this analyzer…').click(); await settle();
  expect(button('Save changes')).toBeDefined();
  button('Delete').click(); await settle();
  expect(del).toHaveBeenCalledWith('/api/compare/analyzers/custom-1');
});

it('reviews candidates one at a time, says how strong each is, and only keeping reaches the case', async () => {
  const row = (id, lon, strength, value) => ({ id, coordinates: [lon, 48], bbox: [lon, 48, lon + 0.001, 48.001],
    area: 90, width: 15, height: 6, margin: 2, strength, measure: { value }, review: 'new',
    phenomenon: 'Surface change', parts: [{ frames: ['a', 'b'], box: [0, 0, 4, 4] }, { frames: ['c', 'd'], box: [0, 0, 2, 4] }] });
  const saved = { id: '123456789abc', title: 'Harbour sweep', status: 'ready', progress: 1, total: 1,
    count: 2, engine_version: 2, results: [row('0-1', 2, 'strong', 12.34), row('0-2', 2.002, 'weak', 8)],
    input: { title: 'Harbour sweep', zones: area, recipe: structuredClone(recipe),
      a: { provider: 'sentinel2', date: '2026-05-04' }, b: { provider: 'sentinel2', date: '2026-05-11' },
      offline: false, date_rule: 'manual', followup_id: null } };
  get.mockImplementation(async (path) => {
    if (path === '/api/compare/analyzers') return catalogue();
    if (path === '/api/cases/case-a/analysis/runs/123456789abc') return structuredClone(saved);
    return [];
  });
  patch.mockImplementation(async (_, body) => ({ ...saved.results[0], ...body }));
  post.mockImplementation(async () => ({ entity: { id: 'e1', type: 'place' },
    result: { ...saved.results[1], review: 'kept', entity_id: 'e1' } }));

  live = mount(Panel, { target, props: { caseId: 'case-a', opening: 'runs-123456789abc' } });
  await settle();
  expect(target.textContent).toContain('1 of 2');
  expect(target.textContent).toContain('Completed · 1 tile · 2026-05-04 → 2026-05-11');
  expect(target.textContent).toContain('Strong · Reflectance moved by 12.3%');
  expect(target.textContent).toContain('2 still to review · 0 kept, 0 dismissed');
  // a candidate across two tiles is one picture, not pages of parts
  expect(target.textContent).not.toContain('Evidence part');
  expect(target.textContent).not.toContain('Signal score');
  expect(target.querySelector('img.preview').getAttribute('src')).toBe(
    '/api/cases/case-a/analysis/runs/123456789abc/results/0-1/preview');

  // Dismissing is a verdict on this one, and it moves on to the next.
  button('Dismiss').click(); await settle();
  expect(patch).toHaveBeenCalledWith(
    '/api/cases/case-a/analysis/runs/123456789abc/results/0-1', { review: 'dismissed' });
  expect(post).not.toHaveBeenCalled();
  expect(target.textContent).toContain('2 of 2');
  expect(target.textContent).toContain('Weak · Reflectance moved by 8.0%');

  // Keeping is the one act that files a pin, and it says so where it happened.
  button('Keep as a pin').click(); await settle();
  expect(post).toHaveBeenCalledWith(
    '/api/cases/case-a/analysis/runs/123456789abc/results/0-2/promote',
    { title: 'Surface change · 48.0000, 2.0020' });
  expect(target.textContent).toContain('Kept as a pin in this case');
  expect(target.textContent).toContain('All 2 reviewed · 1 kept, 1 dismissed');
});

it('picks Copernicus dates from passes the areas have, not from a calendar', async () => {
  post.mockImplementation(async (path) => path === '/api/satellite/sentinel/acquisitions'
    ? { dates: [
        { date: '2026-05-11', cloud: 3, granules: 2, coverage: 1 },
        { date: '2026-05-04', cloud: 12, granules: 1, coverage: 0.62 },
      ], truncated: false }
    : {});
  live = mount(Panel, { target, props: { caseId: 'case-a', zones: area, sources: maps } });
  await settle();
  button('Change dates or the rule…').click(); await settle();

  // a bare date field offered every day since 2015 and knew nothing about any
  expect(target.querySelector('input[type="date"]')).toBe(null);
  // local-first: mounting the panel spends no Copernicus request
  expect(post).not.toHaveBeenCalled();

  button('Find passes').click(); await settle();
  expect(post).toHaveBeenCalledWith('/api/satellite/sentinel/acquisitions',
    expect.objectContaining({ zones: area }));
  expect(target.textContent).toContain('Full cover');
  expect(target.textContent).toContain('62% of the areas');
});

it('says what a partial pass will leave unswept before the run, not after', async () => {
  post.mockImplementation(async () => ({
    dates: [{ date: '2026-05-04', cloud: 12, granules: 1, coverage: 0.62 }], truncated: false,
  }));
  live = mount(Panel, { target, props: { caseId: 'case-a', zones: area, sources: maps } });
  await settle();
  button('Change dates or the rule…').click(); await settle();
  button('Find passes').click(); await settle();
  button('B').click(); await settle();
  expect(target.textContent).toContain('reaches 62% of the areas');
  expect(target.textContent).toContain('not swept');
});

it('runs a saved watch again without asking for its settings twice', async () => {
  const watch = { id: 'abcdef123456', title: 'Harbour weekly', created_at: '2026-09-01T00:00:00Z',
    zones: area, recipe: structuredClone(recipe), a: { provider: 'sentinel2', date: '2026-05-04' },
    b: { provider: 'sentinel2', date: '' }, offline: false, date_rule: 'latest_previous',
    followup_id: 'abcdef123456' };
  get.mockImplementation(async (path) => {
    if (path === '/api/compare/analyzers') return catalogue();
    if (path === '/api/cases/case-a/analysis/followups') return [{ id: watch.id, title: watch.title, created_at: watch.created_at }];
    if (path === `/api/cases/case-a/analysis/followups/${watch.id}`) return watch;
    return [];
  });
  post.mockImplementation(async (_, body) => ({ id: '123456789abc', title: body.title,
    status: 'queued', progress: 0, total: 1, input: body, results: [] }));
  live = mount(Panel, { target, props: { caseId: 'case-a' } });
  await settle();
  button('Saved').click(); await settle();
  button('Run again').click(); await settle();
  expect(post).toHaveBeenCalledWith('/api/cases/case-a/analysis/runs', expect.objectContaining({
    zones: area, date_rule: 'latest_previous', followup_id: watch.id,
  }));
});

it('reopens a run saved against Wayback without pretending it had a Sentinel-2 date', async () => {
  const old = { id: 'aaaaaaaaaaaa', title: 'Old harbour', status: 'ready', progress: 1, total: 1, count: 0,
    engine_version: 1, results: [],
    input: { title: 'Old harbour', zones: area, recipe: { ...structuredClone(recipe), method: 'colour' },
      a: { provider: 'esri-wayback', release: 1 }, b: { provider: 'esri-wayback', release: 2 },
      offline: false, date_rule: 'manual', followup_id: null } };
  get.mockImplementation(async (path) => {
    if (path === '/api/compare/analyzers') return catalogue();
    if (path === '/api/cases/case-a/analysis/runs/aaaaaaaaaaaa') return structuredClone(old);
    return [];
  });
  live = mount(Panel, { target, props: { caseId: 'case-a', opening: 'runs-aaaaaaaaaaaa' } });
  await settle();
  expect(target.textContent).toContain('Wayback release 1 → Wayback release 2');
  button('Edit and rerun').click(); await settle();
  expect(target.textContent).toContain('no date yet');
  expect(button('Run on 1 area').disabled).toBe(true);
});
