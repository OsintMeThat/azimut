// @vitest-environment happy-dom
/** Find's Open menu: the case's searches as cards, each with its photo's picture, when it was made and how it
 * ended, to open or delete. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../lib/api.js', () => ({ api: { get } }));

import SearchesMenu from './SearchesMenu.svelte';

let live = [];
function menu(props) {
  const target = document.createElement('div');
  document.body.append(target);
  live.push({ component: mount(SearchesMenu, { target, props }), target });
  flushSync();
  return target;
}
afterEach(() => {
  for (const { component, target } of live) {
    unmount(component);
    target.remove();
  }
  live = [];
  get.mockReset();
});

describe('the searches menu', () => {
  const searches = [
    { name: 'new', title: 'Ridge search', status: 'running', created_at: '2026-10-18T09:30:00' },
    { name: 'old', title: 'Old search', status: 'done', created_at: '2026-10-14T19:05:00', best: { explained: 0.62 } },
  ];

  it('lists the searches with when each was made and how it ended, to open or delete', () => {
    const onopen = vi.fn();
    const onremove = vi.fn();
    const root = menu({ searches, current: 'new', ready: true, onopen, onremove });
    root.querySelector('button[aria-label="Open a search"]').click();
    flushSync();
    const rows = [...root.querySelectorAll('.sm-row')];
    expect(rows.map((row) => row.querySelector('small').textContent)).toEqual(['18 Oct 2026, 09:30', '14 Oct 2026, 19:05']);
    expect(rows.map((row) => row.querySelector('.search-end').textContent)).toEqual(['running', 'best explains 62%']);
    expect(rows.map((row) => row.querySelector('.search-end').classList.contains('running'))).toEqual([true, false]);
    expect(rows[0].classList.contains('current')).toBe(true);
    root.querySelector('button[aria-label="Delete Old search"]').click();
    expect(onremove).toHaveBeenCalledWith('old');
    rows[1].querySelector('[role="menuitem"]').click();
    flushSync();
    expect(onopen).toHaveBeenCalledWith('old');
    expect(root.querySelector('[role="menu"]')).toBeNull();
  });

  it('shows each search with the picture of its photo, read from the case each time it opens', async () => {
    get.mockResolvedValue([
      { path: 'media/ridge.jpg', thumbnail: '.thumbs/ridge.jpg' },
      { path: 'media/old.jpg' },
    ]);
    const kept = [
      { ...searches[0], photo: 'media/ridge.jpg' },
      { ...searches[1], photo: 'media/old.jpg' },
    ];
    const root = menu({ searches: kept, ready: true, caseId: 'case-1' });
    root.querySelector('button[aria-label="Open a search"]').click();
    flushSync();
    await tick();
    await tick();
    expect(get).toHaveBeenCalledWith('/api/cases/case-1/media');
    const rows = [...root.querySelectorAll('.sm-row')];
    expect(rows[0].querySelector('.search-thumb img').getAttribute('src')).toContain('ridge.jpg');
    // no thumbnail yet: the search's icon stands in
    expect(rows[1].querySelector('.search-thumb img')).toBeNull();
    expect(root.querySelector('.sm-head').textContent).toContain('2');
  });

  it('opens without pictures when the case cannot be read, or with no case', async () => {
    get.mockRejectedValue(new Error('offline'));
    const root = menu({ searches, ready: true, caseId: 'case-1' });
    root.querySelector('button[aria-label="Open a search"]').click();
    flushSync();
    await tick();
    expect(root.querySelectorAll('.sm-row')).toHaveLength(2);
    expect(root.querySelector('.search-thumb img')).toBeNull();
    const bare = menu({ searches, ready: true });
    bare.querySelector('button[aria-label="Open a search"]').click();
    flushSync();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('waits for a case, and says when there is no search yet', () => {
    expect(menu({ searches: [], ready: false }).querySelector('button[aria-label="Open a search"]').disabled).toBe(true);
    const root = menu({ searches: [], ready: true });
    root.querySelector('button[aria-label="Open a search"]').click();
    flushSync();
    expect(root.textContent).toContain('No search yet');
  });
});
