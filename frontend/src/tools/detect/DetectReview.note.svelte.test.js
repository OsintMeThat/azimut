// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/**
 * A run's kept and pinned candidates go into the pinned note as a table: the row is there
 * only while a note is pinned and something was kept, and the queue never counts.
 */
const RUN = '123456789abc';
const area = [{ id: 'area', name: 'Area', kind: 'rect', points: [[2, 48], [2.001, 48.001]] }];
const pass = { provider: 'sentinel2', date: '2026-03-14', layer: 'TRUE_COLOR', maxcc: 30 };
const row = (id, review) => ({ id, coordinates: [2, 48], bbox: [2, 48, 2.001, 48.001], area: 900,
  margin: 2, strength: 'strong', measure: { value: 3 }, review, phenomenon: 'Surface change',
  parts: [{ frames: ['a'], box: [0, 0, 4, 4] }], sources: { a: pass, b: pass } });
const recipe = { id: 'burn', name: 'Burn scars', method: 'surface', colour: '#38bdf8', style: 'both',
  phenomenon: 'Surface change', parameters: {} };
const run = (rows) => ({ id: RUN, title: 'Port fire', status: 'ready', progress: 1, total: 1, count: rows.length, engine_version: 2,
  results: rows, input: { title: 'Port fire', zones: area, recipe, note: '', a: pass, b: pass, offline: false, date_rule: 'manual', followup_id: null } });
let served = run([row('0-1', 'noted'), row('0-2', 'new')]);
const catalogue = { builtins: [recipe], custom: [], max_tiles: 4096, max_results: 2000, grid: [13, 512],
  methods: [{ id: 'surface', single: false, sensor: 'sentinel2', frames: 3, sizes: {}, measure: '{value}' }] };

vi.mock('../../lib/api.js', () => ({ api: {
  get: async (path) => (path === '/api/compare/analyzers' ? structuredClone(catalogue)
    : path.endsWith(`/runs/${RUN}`) ? structuredClone(served) : []),
  post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(),
} }));
vi.mock('../../lib/state.svelte.js', () => ({ ensureCase: async () => ({ id: 'case-a' }),
  reloadCase: async () => {}, toast: vi.fn(), uiState: {}, prefs: { units: 'metric' } }));
const { putInNote } = vi.hoisted(() => ({ putInNote: vi.fn(async () => null) }));
vi.mock('../../lib/notes/putInNote.svelte.js', async (actual) => ({ ...(await actual()), putInNote }));
const { pinNote } = await import('../../lib/notes/putInNote.svelte.js');
const { putsFor } = await import('../../lib/noteHere.svelte.js');
const { default: Panel } = await import('./DetectPanel.svelte');

let live, target;
let unpin = () => {};
const settle = async () => { for (let i = 0; i < 120; i++) await Promise.resolve(); flushSync(); };
afterEach(() => {
  if (live) unmount(live);
  live = null; target?.remove();
  unpin(); unpin = () => {};
  served = run([row('0-1', 'noted'), row('0-2', 'new')]);
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

async function open() {
  target = document.createElement('div'); document.body.append(target);
  live = mount(Panel, { target, props: { caseId: 'case-a', opening: `runs-${RUN}` } });
  await settle();
}
const rowFor = () => target.querySelector('[data-put="kept"]');

it('shows no row while no note is pinned', async () => {
  await open();
  expect(rowFor()).toBeNull();
});

it('names the note and puts the kept candidates in it', async () => {
  unpin = pinNote({ caseId: 'case-a', noteId: 'n1', title: 'Port fire', editor: {} });
  flushSync();
  await open();
  expect(rowFor().textContent.trim()).toBe('Put the kept candidates in “Port fire”');
  rowFor().click();
  expect(putInNote).toHaveBeenCalledOnce();
  expect(putInNote.mock.calls[0][0]).toMatchObject({ id: 'kept' });
  // and the dock's Add lists it too
  expect(putsFor('detect').map((offer) => offer.id)).toEqual(['kept']);
});

it('offers nothing when only the queue is left: an unreviewed candidate is a lead, not a finding', async () => {
  served = run([row('0-1', 'new'), row('0-2', 'new')]);
  unpin = pinNote({ caseId: 'case-a', noteId: 'n1', title: 'Port fire', editor: {} });
  flushSync();
  await open();
  expect(rowFor()).toBeNull();
  expect(putsFor('detect')).toEqual([]);
});
