// @vitest-environment happy-dom
/** The photo dialog: a photo for the view, and in Find the searches the case keeps, to open one. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import PhotoDialog from './PhotoDialog.svelte';

let live = [];
function dialog(props) {
  const target = document.createElement('div');
  document.body.append(target);
  live.push({ component: mount(PhotoDialog, { target, props }), target });
  flushSync();
  return document.body;
}
afterEach(() => {
  for (const { component, target } of live) {
    unmount(component);
    target.remove();
  }
  live = [];
});

describe('the photo dialog', () => {
  it('lists the kept searches in Find, each opened by a click', () => {
    const onopensearch = vi.fn();
    const searches = [
      { name: 'new', title: 'Ridge search', status: 'running', created_at: '2026-10-18T09:30:00' },
      { name: 'old', title: 'Old search', status: 'done', created_at: '2026-10-14T19:05:00', best: { explained: 0.62 } },
    ];
    const root = dialog({ searches, onopensearch });
    expect(root.textContent).toContain('Open a search or add a photo');
    const rows = [...root.querySelectorAll('.search')];
    expect(rows.map((row) => row.querySelector('small').textContent)).toEqual(['18 Oct 2026, 09:30', '14 Oct 2026, 19:05']);
    expect(rows.map((row) => row.querySelector('.search-end').textContent)).toEqual(['running', 'best explains 62%']);
    expect(rows.map((row) => row.querySelector('.search-end').classList.contains('running'))).toEqual([true, false]);
    rows[1].click();
    expect(onopensearch).toHaveBeenCalledWith('old');
  });

  it('shows four searches, the rest behind Show all, and says a confirmed place first', () => {
    const searches = Array.from({ length: 6 }, (_, i) => ({ name: `s${i}`, title: `Search ${i}`, status: 'cancelled', found: i === 0 }));
    const root = dialog({ searches });
    expect(root.querySelectorAll('.search')).toHaveLength(4);
    expect(root.querySelector('.search-end').textContent).toBe('place confirmed');
    const more = root.querySelector('.more');
    expect(more.textContent.trim()).toBe('Show all 6 searches');
    more.click();
    flushSync();
    expect(root.querySelectorAll('.search')).toHaveLength(6);
  });

  it('asks only for the photo outside Find, or when the case keeps no search', () => {
    for (const searches of [null, []]) {
      const root = dialog({ searches });
      expect(root.querySelector('.search')).toBeNull();
      expect(root.textContent).toContain('Add a photo or video');
      for (const { component, target } of live) {
        unmount(component);
        target.remove();
      }
      live = [];
    }
  });
});
