// @vitest-environment happy-dom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const recipe = { id: 'large-change', name: 'Large surface change', description: 'Candidate changes',
  phenomenon: 'Change', method: 'colour', providers: ['esri-wayback', 'sentinel2'], zones: [],
  colour: '#f6a81a', style: 'both', parameters: { sensitivity: 55, min_area: 20, min_score: 0,
    cleanup: 1, smoothing: 0, normalize: false, index: 'ndvi', direction: 'both',
    ignore_clouds: true, ignore_shadows: true, merge_metres: 0 } };
const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();
vi.mock('../../lib/api.js', () => ({ api: { get, post, patch, put: vi.fn(), del: vi.fn() } }));
vi.mock('../../lib/state.svelte.js', () => ({ ensureCase: async () => ({ id: 'case-a' }),
  reloadCase: async () => {}, toast: vi.fn() }));
const { default: Panel } = await import('./AnalyzerPanel.svelte');
let live, target;
const settle = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); flushSync(); };
const button = (text) => [...target.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
const wayback = { a: { provider: 'esri-wayback', wayback_release: 1 },
  b: { provider: 'esri-wayback', wayback_release: 2 } };

beforeEach(() => {
  vi.clearAllMocks();
  get.mockImplementation(async (path) => path === '/api/compare/analyzers'
    ? { builtins: [structuredClone(recipe)], custom: [], methods: [{ id: 'colour', label: 'Colour' }],
        max_tiles: 256, max_results: 2000, grids: { sentinel2: [13, 512], 'esri-wayback': [19, 256] } }
    : []);
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
  const zones = [{ id: 'area', name: 'Area', kind: 'rect', points: [[2, 48], [2.001, 48.001]] }];
  post.mockImplementation(async (_, body) => ({ id: '123456789abc', title: body.title,
    status: 'failed', message: 'Offline fixture', progress: 0, total: 1, input: body, results: [] }));
  live = mount(Panel, { target, props: { caseId: 'case-a', zones, sources: wayback } });
  await settle();
  // No click on an imagery control: the maps above the stage already said it.
  expect(target.textContent).toContain('From the maps');
  expect(post).not.toHaveBeenCalled();
  button('Run on 1 area').click(); await settle();
  expect(post).toHaveBeenCalledWith('/api/cases/case-a/analysis/runs', expect.objectContaining({
    zones, a: expect.objectContaining({ release: 1 }), b: expect.objectContaining({ release: 2 }),
  }));
  expect(target.textContent).toContain('Offline fixture');
});

it('prices an area in tiles and refuses one the engine would reject', async () => {
  const zones = [{ id: 'big', name: 'Whole region', kind: 'rect', points: [[2, 48], [3, 49]] }];
  live = mount(Panel, { target, props: { caseId: 'case-a', zones, sources: wayback } });
  await settle();
  expect(target.textContent).toContain('tiles of 256px');
  expect(button('Run on 1 area').disabled).toBe(true);
  expect(target.textContent).toContain('256-tile limit');
  expect(post).not.toHaveBeenCalled();
});

it('duplicates a built-in analyzer under a name of its own', async () => {
  post.mockImplementation(async (_, body) => ({ ...body, id: 'custom-copy' }));
  live = mount(Panel, { target, props: { caseId: 'case-a' } }); await settle();
  button('Edit or duplicate…').click(); await settle();
  const name = target.querySelector('[aria-label="Analyzer name"]');
  name.value = 'Weekly harbour'; name.dispatchEvent(new Event('input', { bubbles: true }));
  button('Duplicate').click(); await settle();
  expect(post).toHaveBeenCalledWith('/api/compare/analyzers', expect.objectContaining({ id: 'custom', name: 'Weekly harbour' }));
});

it('reviews candidates one at a time, and only keeping reaches the case', async () => {
  const zones = [{ id: 'area', name: 'Area', kind: 'rect', points: [[2, 48], [2.001, 48.001]] }];
  const row = (id, lon) => ({ id, coordinates: [lon, 48], bbox: [lon, 48, lon + 0.001, 48.001],
    area: 90, width: 15, height: 6, signal_score: 0.8, confidence: null, review: 'new',
    phenomenon: 'Surface change', parts: [{ frames: ['a', 'b'], box: [0, 0, 4, 4] }] });
  const saved = { id: '123456789abc', title: 'Harbour sweep', status: 'ready', progress: 1, total: 1,
    count: 2, engine_version: 1, results: [row('0-1', 2), row('0-2', 2.002)],
    input: { title: 'Harbour sweep', zones, recipe: structuredClone(recipe),
      a: { provider: 'esri-wayback', release: 1 }, b: { provider: 'esri-wayback', release: 2 },
      offline: false, date_rule: 'manual', followup_id: null } };
  get.mockImplementation(async (path) => {
    if (path === '/api/compare/analyzers') {
      return { builtins: [structuredClone(recipe)], custom: [], methods: [{ id: 'colour', label: 'Colour' }],
        max_tiles: 4096, max_results: 2000, grids: { 'esri-wayback': [19, 256] } };
    }
    if (path === '/api/cases/case-a/analysis/runs/123456789abc') return structuredClone(saved);
    return [];
  });
  patch.mockImplementation(async (_, body) => ({ ...saved.results[0], ...body }));
  post.mockImplementation(async () => ({ entity: { id: 'e1', type: 'place' },
    result: { ...saved.results[1], review: 'kept', entity_id: 'e1' } }));

  live = mount(Panel, { target, props: { caseId: 'case-a', opening: 'runs-123456789abc' } });
  await settle();
  expect(target.textContent).toContain('Candidate 1 of 2');
  expect(target.textContent).toContain('2 still to review · 0 kept, 0 dismissed');

  // Dismissing is a verdict on this one, and it moves on to the next.
  button('Dismiss').click(); await settle();
  expect(patch).toHaveBeenCalledWith(
    '/api/cases/case-a/analysis/runs/123456789abc/results/0-1', { review: 'dismissed' });
  expect(post).not.toHaveBeenCalled();
  expect(target.textContent).toContain('Candidate 2 of 2');

  // Keeping is the one act that files a pin, and it says so where it happened.
  button('Keep as a pin').click(); await settle();
  expect(post).toHaveBeenCalledWith(
    '/api/cases/case-a/analysis/runs/123456789abc/results/0-2/promote',
    { title: 'Surface change · 48.0000, 2.0020' });
  expect(target.textContent).toContain('Kept · in this case as a pin');
  expect(target.textContent).toContain('All 2 reviewed · 1 kept, 1 dismissed');
});

const sentinelCatalogue = (methods) => ({
  builtins: [structuredClone(recipe)], custom: [], methods,
  max_tiles: 4096, max_results: 2000, grids: { sentinel2: [13, 512], 'esri-wayback': [19, 256] },
});
const sentinelMaps = {
  a: { provider: 'sentinel2', sentinel: { date: '2026-05-04', layer: 'TRUE_COLOR', maxcc: 30 } },
  b: { provider: 'sentinel2', sentinel: { date: '2026-05-11', layer: 'TRUE_COLOR', maxcc: 30 } },
};

it('picks Copernicus dates from passes the areas have, not from a calendar', async () => {
  const zones = [{ id: 'area', name: 'Area', kind: 'rect', points: [[2, 48], [2.001, 48.001]] }];
  get.mockImplementation(async (path) => path === '/api/compare/analyzers'
    ? sentinelCatalogue([{ id: 'colour', label: 'Colour', cloud_filter: 'picture' }]) : []);
  post.mockImplementation(async (path) => path === '/api/satellite/sentinel/acquisitions'
    ? { dates: [
        { date: '2026-05-11', cloud: 3, granules: 2, coverage: 1 },
        { date: '2026-05-04', cloud: 12, granules: 1, coverage: 0.62 },
      ], truncated: false }
    : {});
  live = mount(Panel, { target, props: { caseId: 'case-a', zones, sources: sentinelMaps } });
  await settle();
  button('Change imagery, dates or the rule…').click(); await settle();

  // a bare date field offered every day since 2015 and knew nothing about any
  expect(target.querySelector('input[type="date"]')).toBe(null);
  // local-first: mounting the panel spends no Copernicus request
  expect(post).not.toHaveBeenCalled();

  button('Find passes').click(); await settle();
  expect(post).toHaveBeenCalledWith('/api/satellite/sentinel/acquisitions',
    expect.objectContaining({ zones }));
  expect(target.textContent).toContain('Full cover');
  expect(target.textContent).toContain('62% of the areas');
});

it('says what a partial pass will leave unswept before the run, not after', async () => {
  const zones = [{ id: 'area', name: 'Area', kind: 'rect', points: [[2, 48], [2.001, 48.001]] }];
  get.mockImplementation(async (path) => path === '/api/compare/analyzers'
    ? sentinelCatalogue([{ id: 'colour', label: 'Colour', cloud_filter: 'picture' }]) : []);
  post.mockImplementation(async () => ({
    dates: [{ date: '2026-05-04', cloud: 12, granules: 1, coverage: 0.62 }], truncated: false,
  }));
  live = mount(Panel, { target, props: { caseId: 'case-a', zones, sources: sentinelMaps } });
  await settle();
  button('Change imagery, dates or the rule…').click(); await settle();
  button('Find passes').click(); await settle();
  button('B').click(); await settle();
  expect(target.textContent).toContain('reaches 62% of the areas');
  expect(target.textContent).toContain('not swept');
});

it('offers the cloud guess off, and says it is a guess', async () => {
  get.mockImplementation(async (path) => path === '/api/compare/analyzers'
    ? sentinelCatalogue([{ id: 'colour', label: 'Colour', cloud_filter: 'picture' }]) : []);
  live = mount(Panel, { target, props: { caseId: 'case-a', sources: wayback } });
  await settle();
  const chip = [...target.querySelectorAll('button')].find((b) => b.textContent.includes('Clouds & shadows'));
  // a test that cannot tell cloud from a white roof is never on by default
  expect(chip.getAttribute('aria-pressed')).toBe('false');
  expect(target.textContent).toContain('A guess from the picture');
  chip.click(); await settle();
  expect(chip.getAttribute('aria-pressed')).toBe('true');
});

it('offers no cloud switch where masking cloud would mask the subject', async () => {
  get.mockImplementation(async (path) => path === '/api/compare/analyzers'
    ? sentinelCatalogue([{ id: 'colour', label: 'Smoke', cloud_filter: '' }]) : []);
  live = mount(Panel, { target, props: { caseId: 'case-a', sources: wayback } });
  await settle();
  expect(target.textContent).not.toContain('Clouds & shadows');
});

it('runs a saved watch again without asking for its settings twice', async () => {
  const zones = [{ id: 'area', name: 'Area', kind: 'rect', points: [[2, 48], [2.001, 48.001]] }];
  const watch = { id: 'abcdef123456', title: 'Harbour weekly', created_at: '2026-09-01T00:00:00Z',
    zones, recipe: structuredClone(recipe), a: { provider: 'esri-wayback', release: 1 },
    b: { provider: 'esri-wayback', release: 2 }, offline: false, date_rule: 'latest_previous',
    followup_id: 'abcdef123456' };
  get.mockImplementation(async (path) => {
    if (path === '/api/compare/analyzers') {
      return { builtins: [structuredClone(recipe)], custom: [], methods: [], max_tiles: 256,
        grids: { 'esri-wayback': [19, 256] } };
    }
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
    zones, date_rule: 'latest_previous', followup_id: watch.id,
  }));
});
