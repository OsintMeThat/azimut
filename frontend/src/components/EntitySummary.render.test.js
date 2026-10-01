// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/** The top of Details: what an entity is, and what the case's events say about it. */

const rows = {
  o1: {
    events: 5, first: '2026-03-11T00:00:00.000000Z', last: '2026-03-20T00:00:00.000000Z',
    sources: 2, places: 1, buckets: [0, 0, 0, 0, 2, 1, 1, 0, 0, 1, 0, 0],
  },
  p1: { events: 0, first: null, last: null, sources: 0, places: 0, buckets: Array(12).fill(0) },
};
const post = vi.fn(async (_url, body) => ({ range: null, rows: { [body.ids[0]]: rows[body.ids[0]] } }));
vi.mock('../lib/api.js', () => ({ api: { post, get: vi.fn(async () => []) } }));

const uiState = { tool: 'board', timelineFocus: null };
vi.mock('../lib/state.svelte.js', () => ({ caseState: { rev: 0, current: { id: 'case-a' } }, uiState }));
vi.mock('../lib/entityTypes.svelte.js', () => ({
  entityFamily: (type) => ({ organization: 'actor', person: 'actor', claim: 'claim' })[type] ?? null,
  entityLabel: (type) => type.charAt(0).toUpperCase() + type.slice(1),
}));
vi.mock('../lib/entityIcon.js', () => ({ entityIcon: () => 'user' }));
vi.mock('./EntryLine.svelte', async () => ({
  default: (await import('./Modal.svelte')).default,
  claimSeat: (entity) => (entity?.type === 'claim' ? null : { slot: 'about' }),
}));

const { default: EntitySummary } = await import('./EntitySummary.svelte');

let live = null;
let target = null;

async function settle() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
  flushSync();
}

async function show(entity) {
  target = document.createElement('div');
  document.body.append(target);
  live = mount(EntitySummary, { target, props: { caseId: 'case-a', entity, onclose: vi.fn() } });
  flushSync();
  await settle();
}

beforeEach(() => {
  vi.clearAllMocks();
  uiState.tool = 'board';
  uiState.timelineFocus = null;
});

afterEach(() => {
  if (live) unmount(live);
  live = null;
  target?.remove();
  document.querySelectorAll('[role="dialog"]').forEach((node) => node.remove());
});

describe('the summary above Details', () => {
  it('names the entity, its type and its other names', async () => {
    await show({ id: 'o1', type: 'organization', label: '4th brigade', attrs: { aliases: '4 Bde; 4th Mech' } });
    expect(target.querySelector('h3').textContent).toBe('4th brigade');
    expect(target.querySelector('.kind').textContent).toContain('Organization');
    expect(target.querySelector('.also').textContent).toContain('4 Bde, 4th Mech');
  });

  it('says how many events name it, what they reach and when they fall', async () => {
    await show({ id: 'o1', type: 'organization', label: '4th brigade', attrs: {} });
    expect(target.querySelector('.facts').textContent).toBe('5 events · 2 sources · 1 place');
    expect(target.querySelector('.span').textContent).toBe('11–19 Mar 2026');
    expect(target.querySelector('svg.sparkline')).not.toBeNull();
    expect(post).toHaveBeenCalledWith('/api/cases/case-a/catalog/events', { ids: ['o1'] });
  });

  it('opens the Timeline on the entity', async () => {
    await show({ id: 'o1', type: 'organization', label: '4th brigade', attrs: {} });
    [...target.querySelectorAll('button')].find((b) => b.textContent.includes('Timeline')).click();
    expect(uiState.tool).toBe('timeline');
    expect(uiState.timelineFocus).toMatchObject({ entityId: 'o1', entityLabel: '4th brigade' });
  });

  it('says when nothing names it yet, and offers the first event', async () => {
    await show({ id: 'p1', type: 'person', label: 'Witness', attrs: {} });
    expect(target.querySelector('.facts').textContent).toBe('No events yet');
    const add = [...target.querySelectorAll('button')].find((b) => b.textContent.includes('Add event'));
    expect(add.getAttribute('aria-expanded')).toBe('false');
    add.click();
    flushSync();
    await settle();
    expect(add.getAttribute('aria-expanded')).toBe('true');
    expect(target.querySelector('.compose')).not.toBeNull();
  });

  it('adds nothing about a Claim, which is itself an event', async () => {
    await show({ id: 'k1', type: 'claim', label: 'Column seen', attrs: {} });
    expect(target.querySelector('.strip')).toBeNull();
    expect([...target.querySelectorAll('button')].some((b) => b.textContent.includes('Add event'))).toBe(false);
    expect(post).not.toHaveBeenCalled();
  });
});
