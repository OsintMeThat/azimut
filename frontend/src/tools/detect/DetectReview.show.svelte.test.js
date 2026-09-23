// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/**
 * Opening a run puts its pass on the map, and the map's own state must not
 * feed back into the review. A radar pass is an object, so writing it always
 * looked new: the review's effect re-ran on it until Svelte stopped the page,
 * and the overlay and the tabs froze where they were.
 */
const RUN = '123456789abc';
const area = [{ id: 'area', name: 'Area', kind: 'rect', points: [[2, 48], [2.001, 48.001]] }];
const pass = { provider: 'sentinel1', date: '2026-09-22', layer: 'RADAR', maxcc: 100, time: '02:06:41' };
const other = { ...pass, date: '2026-09-10', time: '02:06:40' };
const row = (id, source) => ({ id, coordinates: [2, 48], bbox: [2, 48, 2.001, 48.001], area: 90, width: 15,
  height: 6, margin: 2, strength: 'strong', measure: { value: 3 }, review: 'new', phenomenon: 'Vessel candidate (radar)',
  parts: [{ frames: ['a'], box: [0, 0, 4, 4] }], sources: { a: source, b: source } });
const recipe = { id: 'radar-vessels', name: 'Vessels by radar', method: 'sar-vessels', colour: '#38bdf8', style: 'both',
  phenomenon: 'Vessel candidate (radar)', parameters: {} };
const run = { id: RUN, title: 'Vessels by radar', status: 'ready', progress: 1, total: 1, count: 3, engine_version: 2,
  results: [row('0-1', pass), row('0-2', pass), row('0-3', other)],
  input: { title: 'Vessels by radar', zones: area, recipe, note: '', a: pass, b: pass, offline: false,
    date_rule: 'manual', followup_id: null } };
const catalogue = { builtins: [recipe], custom: [], max_tiles: 4096, max_results: 2000, grid: [13, 512],
  methods: [{ id: 'sar-vessels', single: true, sensor: 'sentinel1', frames: 3, sizes: {}, measure: '{value} dB' }] };

vi.mock('../../lib/api.js', () => ({ api: {
  get: async (path) => (path === '/api/compare/analyzers' ? structuredClone(catalogue)
    : path.endsWith(`/runs/${RUN}`) ? structuredClone(run) : []),
  post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(),
} }));
vi.mock('../../lib/state.svelte.js', () => ({ ensureCase: async () => ({ id: 'case-a' }),
  reloadCase: async () => {}, toast: vi.fn(), uiState: {}, prefs: { units: 'metric' } }));
const { default: Panel } = await import('./DetectPanel.svelte');

let live, target;
const settle = async () => { for (let i = 0; i < 120; i++) await Promise.resolve(); flushSync(); };
afterEach(() => { if (live) unmount(live); live = null; target?.remove(); });

it('shows a radar pass once, however the map writes it back', async () => {
  // what Detect does: the shown pass is read and replaced by a fresh object
  const map = $state({ pass: null });
  const shown = [];
  const onshow = (source) => { shown.push(`${source.date} ${source.time}`); void map.pass; map.pass = { ...source }; };
  const errors = [];
  const onerror = (event) => errors.push(event.message ?? String(event));
  window.addEventListener('error', onerror);
  target = document.createElement('div'); document.body.append(target);
  live = mount(Panel, { target, props: { caseId: 'case-a', opening: `runs-${RUN}`, onshow } });
  await settle();
  expect(target.textContent).toContain('1 of 3');
  // stepping to a candidate on the same pass leaves the map alone
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); await settle();
  expect(target.textContent).toContain('2 of 3');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); await settle();
  expect(target.textContent).toContain('3 of 3');
  window.removeEventListener('error', onerror);
  expect(errors).toEqual([]);
  // opening the run and the review each name its pass; a loop names it hundreds of times
  expect(shown.length).toBeLessThanOrEqual(3);
  expect([...new Set(shown)]).toEqual(['2026-09-22 02:06:41', '2026-09-10 02:06:40']);
});
