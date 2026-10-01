// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/**
 * The Board read as groups, driven the way an analyst reads it: who and what first,
 * the material folded under it, each group paging on its own answer.
 */

const TYPES = [
  { type: 'person', label: 'Person', family: 'actor', hint: 'somebody', attrs: [], manual: true },
  { type: 'organization', label: 'Organization', family: 'actor', hint: 'a group', attrs: [], manual: true },
  { type: 'place', label: 'Place', family: 'place', hint: 'somewhere', attrs: [] },
  { type: 'media', label: 'Media', family: 'collected', hint: 'a file', attrs: [] },
  { type: 'capture', label: 'Capture', family: 'collected', hint: 'a map image', attrs: [] },
  { type: 'claim', label: 'Claim', family: 'claim', hint: 'what is said', attrs: [], manual: true },
];

let ROWS = [];
const row = (id, type, label, extra = {}) => ({
  id, type, label, attrs: {}, provenance: { at: '2026-08-01T00:00:00Z', status: 'confirmed' }, ...extra,
});

function withSubjects() {
  ROWS = [
    row('p1', 'person', 'Witness'),
    row('o1', 'organization', '4th brigade'),
    row('pl1', 'place', 'Crossroads'),
    row('m1', 'media', 'VID_0312'),
    row('c1', 'capture', 'S2 11/03'),
    row('k1', 'claim', 'Column seen', { attrs: { when: '2026-03-12' } }),
  ];
}
function filesOnly() {
  ROWS = [row('m1', 'media', 'VID_0312'), row('c1', 'capture', 'S2 11/03')];
}

const summary = () => ({
  total: ROWS.length,
  by_type: Object.fromEntries(
    [...new Set(ROWS.map((r) => r.type))].map((t) => [t, ROWS.filter((r) => r.type === t).length])
  ),
  by_status: { suggested: 2 },
  by_folder: {},
  by_source: {},
  unlinked: 0,
  lacks: { source: 1, assessment: 0 },
});

const asked = [];
const get = vi.fn(async (url) => {
  if (url.includes('/entity-types')) return TYPES;
  if (url.includes('/relation-types')) return [];
  if (url.includes('/confidence-levels')) return [];
  if (url.includes('/catalog/summary')) return summary();
  if (url.includes('/catalog/entities')) {
    const params = new URL(url, 'http://x').searchParams;
    asked.push(params);
    const q = (params.get('q') ?? '').toLowerCase();
    const matched = ROWS.filter((r) => !q || r.label.toLowerCase().includes(q));
    if (params.get('counts') === 'type') {
      const byType = {};
      for (const r of matched) byType[r.type] = (byType[r.type] ?? 0) + 1;
      return { items: matched.slice(0, 1), total: matched.length, next_cursor: null, by_type: byType };
    }
    const types = (params.get('type') ?? '').split(',').filter(Boolean);
    const items = matched.filter((r) => !types.length || types.includes(r.type));
    return { items, total: items.length, next_cursor: null };
  }
  if (url.includes('/catalog/attributes')) return { attrs: [] };
  if (url.includes('/analysis-views')) return { views: [] };
  return {};
});
const post = vi.fn(async (url, body) => {
  if (url.includes('/catalog/events')) {
    return {
      range: { from: '2026-03-01T00:00:00.000000Z', to: '2026-04-01T00:00:00.000000Z' },
      rows: Object.fromEntries(
        body.ids.map((id) => [
          id,
          id === 'o1'
            ? {
                events: 5, first: '2026-03-11T00:00:00.000000Z', last: '2026-03-20T00:00:00.000000Z',
                sources: 2, places: 1, buckets: [0, 0, 0, 0, 2, 1, 1, 0, 0, 1, 0, 0],
              }
            : { events: 0, first: null, last: null, sources: 0, places: 0, buckets: Array(12).fill(0) },
        ])
      ),
    };
  }
  return {};
});
vi.mock('../lib/api.js', () => ({
  api: { get, post, del: vi.fn(), patch: vi.fn(), put: vi.fn() },
  ApiError: Error,
}));

const toast = vi.fn();
const uiState = { tool: 'board', openBoardEntity: null, drawInGraph: null, openGraphEntity: null };
vi.mock('../lib/state.svelte.js', async () => {
  const { caseState } = await import('../components/views.fixture.svelte.js');
  return {
    caseState,
    reloadCase: vi.fn(async () => {}),
    toast,
    uiState,
    registerCaseChangeGuard: () => () => {},
  };
});
vi.mock('../components/EntityDetails.svelte', async () => await import('../components/Modal.svelte'));

const { default: Board } = await import('./Board.svelte');
const { openAnalysisCase } = await import('../lib/analysisSearch.svelte.js');

let live = null;
let target = null;

async function settle() {
  for (let index = 0; index < 20; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  flushSync();
}

async function open() {
  target = document.createElement('div');
  document.body.append(target);
  live = mount(Board, { target });
  flushSync();
  await settle();
  return target;
}

const groups = () =>
  [...target.querySelectorAll('section.group')].map((section) => ({
    title: section.querySelector('.title')?.textContent.trim(),
    count: section.querySelector('.count')?.textContent.trim(),
    open: section.querySelector('button.fold')?.getAttribute('aria-expanded') === 'true',
    rows: [...section.querySelectorAll('tbody tr .name')].map((name) => name.textContent.trim()),
    section,
  }));
const group = (title) => groups().find((entry) => entry.title === title);

beforeEach(() => {
  vi.clearAllMocks();
  asked.length = 0;
  localStorage.clear();
  // The question outlives a mount, as it does between tabs: each test starts on none.
  openAnalysisCase(null);
  withSubjects();
});

afterEach(() => {
  if (live) unmount(live);
  live = null;
  target?.remove();
});

describe('the groups', () => {
  it('reads who and what first, the material folded under it', async () => {
    await open();
    expect(groups().map((entry) => [entry.title, entry.count, entry.open])).toEqual([
      ['People & organizations', '2', true],
      ['Places', '1', true],
      ['Events', '1', false],
      ['Files', '2', false],
    ]);
    expect(group('People & organizations').rows).toEqual(['Witness', '4th brigade']);
    // folded, a group says what is inside it, and reads nothing
    expect(group('Files').section.querySelector('.types').textContent).toContain('Capture, Media');
    expect(asked.some((params) => params.get('type') === 'capture,media')).toBe(false);
  });

  it('reads a folded group when it is opened, and remembers the fold for the case', async () => {
    await open();
    group('Files').section.querySelector('button.fold').click();
    flushSync();
    await settle();
    expect(group('Files').open).toBe(true);
    expect(group('Files').rows).toEqual(['VID_0312', 'S2 11/03']);
    expect(JSON.parse(localStorage.getItem('azimut:board-layout:case-a')).folds).toEqual({ collected: true });
  });

  it('says what the events say about each subject row', async () => {
    await open();
    const brigade = [...target.querySelectorAll('tr')].find((tr) => tr.textContent.includes('4th brigade'));
    expect(brigade.querySelector('td.n').textContent.trim()).toBe('5');
    expect(brigade.querySelector('td.span').textContent.trim()).toBe('11–19 Mar 2026');
    expect(brigade.querySelector('svg.sparkline')).not.toBeNull();
    const witness = [...target.querySelectorAll('tr')].find((tr) => tr.textContent.includes('Witness'));
    expect(witness.querySelector('td.n').textContent.trim()).toBe('—');
    // one read for the page of subject rows, never one per row
    const reads = post.mock.calls.filter(([url]) => url.includes('/catalog/events'));
    expect(reads).toHaveLength(1);
    expect(reads[0][1].ids.sort()).toEqual(['o1', 'p1', 'pl1']);
  });

  it('orders the subjects most noted first, and the material newest first', async () => {
    await open();
    group('Files').section.querySelector('button.fold').click();
    flushSync();
    await settle();
    const order = (types) => asked.find((params) => params.get('type') === types && !params.get('counts'))?.get('order');
    expect(order('organization,person')).toBe('-events');
    expect(order('place')).toBe('-events');
    expect(order('capture,media')).toBe('-created');
  });

  it('opens every group holding an answer under a question', async () => {
    await open();
    const search = target.querySelector('input[placeholder="Search the case…"]');
    search.value = 'vid';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 320));
    await settle();
    expect(groups().map((entry) => [entry.title, entry.open])).toEqual([['Files', true]]);
    expect(group('Files').rows).toEqual(['VID_0312']);
  });

  it('shows the waiting questions, priced, and asks one on a click', async () => {
    await open();
    const line = target.querySelector('.waiting-line');
    expect(line.textContent).toContain('2 to review');
    expect(line.textContent).toContain('1 event without a source');
    [...line.querySelectorAll('button')].find((b) => b.textContent.includes('to review')).click();
    flushSync();
    await settle();
    expect(asked.some((params) => params.get('status') === 'suggested')).toBe(true);
  });

  it('lays out one flat table under Group: None, and keeps that choice', async () => {
    await open();
    const select = [...target.querySelectorAll('label.pick-one')]
      .find((label) => label.textContent.includes('Group'))
      .querySelector('select');
    select.value = 'none';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    await settle();
    expect(target.querySelector('section.group')).toBeNull();
    expect(target.querySelectorAll('.table tbody tr')).toHaveLength(ROWS.length);
    expect(JSON.parse(localStorage.getItem('azimut:board-layout:case-a')).group).toBe('none');
  });
});

describe('a case of files only', () => {
  it('opens its files, and says how the index fills', async () => {
    filesOnly();
    await open();
    expect(target.querySelector('.no-subjects').textContent).toContain('No people, places or things yet.');
    expect(groups().map((entry) => [entry.title, entry.open])).toEqual([['Files', true]]);
  });
});
