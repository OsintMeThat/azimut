// @vitest-environment happy-dom
/** Find's Open menu: the case's searches, each with when it was made and how it ended, to open or delete. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
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
    expect(rows.map((row) => row.querySelector('small').textContent)).toEqual(['18 Oct 2026, 09:30 · running', '14 Oct 2026, 19:05 · best explains 62%']);
    expect(rows[0].classList.contains('current')).toBe(true);
    root.querySelector('button[aria-label="Delete Old search"]').click();
    expect(onremove).toHaveBeenCalledWith('old');
    rows[1].querySelector('[role="menuitem"]').click();
    flushSync();
    expect(onopen).toHaveBeenCalledWith('old');
    expect(root.querySelector('[role="menu"]')).toBeNull();
  });

  it('waits for a case, and says when there is no search yet', () => {
    expect(menu({ searches: [], ready: false }).querySelector('button[aria-label="Open a search"]').disabled).toBe(true);
    const root = menu({ searches: [], ready: true });
    root.querySelector('button[aria-label="Open a search"]').click();
    flushSync();
    expect(root.textContent).toContain('No search yet');
  });
});
