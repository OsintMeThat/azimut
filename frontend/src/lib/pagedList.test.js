import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPagedList } from './pagedList.svelte.js';

/** A fake backend paging a fixed id list, recording the queries it received. */
function backend(ids, { pageSize = 100 } = {}) {
  const calls = [];
  const fetchPage = async ({ query, cursor }) => {
    calls.push({ query, cursor });
    const all = query ? ids.filter((id) => id.includes(query)) : ids;
    const start = cursor ? Number(cursor) : 0;
    const slice = all.slice(start, start + pageSize).map((id) => ({ id }));
    const next = start + pageSize < all.length ? String(start + pageSize) : null;
    return { items: slice, next_cursor: next, total: all.length, facets: { kind_counts: {} } };
  };
  return { fetchPage, calls };
}

describe('createPagedList — small case (single page)', () => {
  it('filters client-side with no extra fetch', async () => {
    const { fetchPage, calls } = backend(['alpha', 'beta', 'gamma']);
    const list = createPagedList({ fetchPage });
    await list.reload();
    expect(list.items.map((i) => i.id)).toEqual(['alpha', 'beta', 'gamma']);
    expect(list.serverMode).toBe(false);
    expect(list.hasMore).toBe(false);

    list.setQuery('bet'); // small case → consumer filters in memory
    expect(calls).toHaveLength(1); // no second network call
  });
});

describe('createPagedList — large case (multi page)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('goes server-side and debounces the query', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `item${i}`);
    const { fetchPage, calls } = backend(ids, { pageSize: 100 });
    const list = createPagedList({ fetchPage, debounceMs: 250 });
    await list.reload();
    expect(list.serverMode).toBe(true);
    expect(list.hasMore).toBe(true);
    expect(list.total).toBe(250);

    list.setQuery('item1');
    expect(calls).toHaveLength(1); // not yet — debounced
    await vi.advanceTimersByTimeAsync(250);
    expect(calls.at(-1).query).toBe('item1');
  });

  it('loadMore appends the next page and clears hasMore at the end', async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `item${i}`);
    const { fetchPage } = backend(ids, { pageSize: 100 });
    const list = createPagedList({ fetchPage });
    await list.reload();
    expect(list.items).toHaveLength(100);
    await list.loadMore();
    expect(list.items).toHaveLength(150);
    expect(list.hasMore).toBe(false);
  });

  it('stays server-side even when a narrow query fits one page', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `item${i}`);
    const { fetchPage } = backend(ids, { pageSize: 100 });
    const list = createPagedList({ fetchPage, debounceMs: 0 });
    await list.reload();
    list.setQuery('item42'); // one match → single page
    await vi.advanceTimersByTimeAsync(0);
    expect(list.hasMore).toBe(false);
    expect(list.serverMode).toBe(true); // sticky: a broader query must re-hit the server
  });
});

describe('createPagedList — superseded loads', () => {
  it('a slow earlier load does not clobber a newer one', async () => {
    let resolveFirst;
    const seq = [
      new Promise((r) => (resolveFirst = r)),
      Promise.resolve({ items: [{ id: 'new' }], next_cursor: null, total: 1 }),
    ];
    let n = 0;
    const fetchPage = () => seq[n++];
    const list = createPagedList({ fetchPage });

    const p1 = list.reload();
    const p2 = list.reload(); // supersedes p1
    await p2;
    expect(list.items.map((i) => i.id)).toEqual(['new']);
    resolveFirst({ items: [{ id: 'old' }], next_cursor: null, total: 1 });
    await p1;
    expect(list.items.map((i) => i.id)).toEqual(['new']); // not clobbered
  });
});
