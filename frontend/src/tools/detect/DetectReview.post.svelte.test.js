// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/**
 * A run's pins go To Post as a free post carrying their pictures: one pin from its own
 * footer, the run's pins from its head, as many as a post holds. A candidate only kept
 * here has no picture, so a run of those says so rather than post anything.
 */
const RUN = '123456789abc';
const area = [{ id: 'area', name: 'Area', kind: 'rect', points: [[2, 48], [2.001, 48.001]] }];
const a = { provider: 'sentinel2', date: '2026-03-02', layer: 'TRUE_COLOR', maxcc: 30 };
const b = { ...a, date: '2026-03-14' };
const row = (id, review, extra = {}) => ({ id, coordinates: [2, 48], bbox: [2, 48, 2.001, 48.001], area: 900,
  margin: 2, strength: 'strong', measure: { value: 3 }, review, phenomenon: 'Surface change',
  parts: [{ frames: ['a'], box: [0, 0, 4, 4] }], sources: { a, b }, ...extra });
const pin = (index) => row(`pin-${index}`, 'kept', { entity_id: `place-${index}`, title: `Hangar ${index}`, description: index === 1 ? 'Scorched roof' : '' });
const recipe = { id: 'burn', name: 'Burn scars', method: 'surface', colour: '#38bdf8', style: 'both',
  phenomenon: 'Surface change', parameters: {} };
const run = (rows) => ({ id: RUN, title: 'Port fire', status: 'ready', progress: 1, total: 1, count: rows.length, engine_version: 2,
  results: rows, input: { title: 'Port fire', zones: area, recipe, note: '', a, b, offline: false, date_rule: 'manual', followup_id: null } });
let served = run([pin(1), row('noted-1', 'noted')]);
const catalogue = { builtins: [recipe], custom: [], max_tiles: 4096, max_results: 2000, grid: [13, 512],
  methods: [{ id: 'surface', single: false, sensor: 'sentinel2', frames: 3, sizes: {}, measure: '{value}' }] };

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../lib/api.js', () => ({ api: { get, post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() } }));
const { uiState } = vi.hoisted(() => ({ uiState: { tool: 'detect', postStart: null } }));
vi.mock('../../lib/state.svelte.js', () => ({ ensureCase: async () => ({ id: 'case-a' }),
  reloadCase: async () => {}, toast: vi.fn(), uiState, prefs: { units: 'metric' } }));
const { default: Panel } = await import('./DetectPanel.svelte');

let live, target;
const settle = async () => { for (let i = 0; i < 120; i++) await Promise.resolve(); flushSync(); };
function answer(path) {
  if (path === '/api/compare/analyzers') return structuredClone(catalogue);
  if (path.endsWith(`/runs/${RUN}`)) return structuredClone(served);
  const chain = /\/entities\/place-(\d+)\/chain$/.exec(path);
  if (chain) return { entity: { id: `place-${chain[1]}`, label: `Hangar ${chain[1]}`, attrs: { evidence: `media/Hangar ${chain[1]}.png` } } };
  return [];
}
afterEach(() => {
  if (live) unmount(live);
  live = null; target?.remove();
  served = run([pin(1), row('noted-1', 'noted')]);
  uiState.tool = 'detect'; uiState.postStart = null;
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

async function open() {
  get.mockImplementation(async (path) => answer(path));
  target = document.createElement('div'); document.body.append(target);
  live = mount(Panel, { target, props: { caseId: 'case-a', opening: `runs-${RUN}` } });
  await settle();
}
const toPost = (root) => [...root.querySelectorAll('button')].find((node) => node.textContent.trim() === 'To Post');

it('sends a pin To Post from its footer with its picture, its name, its words and its passes', async () => {
  await open();
  const foot = target.querySelector('.review-actions');
  expect(foot.textContent).toContain('Kept as a pin in this case');
  toPost(foot).click();
  await settle();
  expect(uiState.tool).toBe('post');
  expect(uiState.postStart).toEqual({ kind: 'free', media: ['media/Hangar 1.png'], about: {
    title: 'Hangar 1', description: 'Scorched roof', dates: ['2026-03-02', '2026-03-14'], credits: '' } });
});

it('sends the run\'s pins To Post from its head, as many as one post holds, under the run\'s name', async () => {
  served = run([1, 2, 3, 4, 5].map(pin));
  await open();
  const head = target.querySelector('.run-acts');
  expect(toPost(head).title).toBe('A free post with the 4 pinned pictures, the first 4 of 5');
  toPost(head).click();
  await settle();
  expect(uiState.postStart.media).toEqual([1, 2, 3, 4].map((index) => `media/Hangar ${index}.png`));
  expect(uiState.postStart.about).toMatchObject({ title: 'Port fire', description: '' });
});

it('says a run with nothing pinned has no picture to post, and posts nothing', async () => {
  served = run([row('noted-1', 'noted'), row('new-1', 'new')]);
  await open();
  const button = toPost(target.querySelector('.run-acts'));
  expect(button.disabled).toBe(true);
  expect(button.title).toBe('Only a pin files a picture: pin a candidate first');
  expect(uiState.postStart).toBeNull();
  // a run where nothing was kept offers it not at all
  unmount(live); live = null; target.remove();
  served = run([row('new-1', 'new')]);
  await open();
  expect(toPost(target.querySelector('.run-acts'))).toBeUndefined();
});
